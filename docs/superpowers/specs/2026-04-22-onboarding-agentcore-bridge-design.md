# Onboarding browser ↔ AgentCore bridge — design

**Status:** Proposed
**Author:** fabio-vitali + Claude
**Date:** 2026-04-22
**Blocks:** [Playwright UI e2e](./2026-04-22-playwright-e2e-ui-design.md) Phase 1 (prerequisite **P3**)

## Why this spec exists

`apps/onboarding-mfe/src/app/onboarding/onboarding-chat.component.ts:58` posts to `/api/copilotkit`. Nothing in the repo serves that path. The real agent lives behind Bedrock AgentCore (`POST /invocations`, SigV4-gated), so the browser has no way to reach it today. The Playwright spec's §P3 describes this gap in full — this spec does not re-derive it; it specifies the resolution.

The Playwright spec locked the direction as a "Cognito-authed BFF bridge." This spec refines that decision after discovering that the `AgentRuntime` CDK construct already supports native Cognito JWT auth (`libs/cdk-constructs/src/extensions/agent-runtime.ts:62`) and that `services/investor/investor-web` already owns a CloudFront distribution fronting the SPA. The result: **no bridge Lambda is needed**. CloudFront reverse-proxies directly to AgentCore, which itself validates the Cognito JWT.

## Goals

- Provide a Cognito-authenticated, streaming-capable HTTP path from the browser to the onboarding AgentCore runtime.
- Keep the browser's existing CopilotKit `HttpAgent` shape — no client-library swap.
- Reuse the AgentCore-native JWT authorizer; avoid custom auth code.
- Extend existing infrastructure rather than stand up parallel plumbing.

## Non-goals

- Any change to the Hono server inside the AgentCore container (`agents/onboarding/server.ts`). Its wire protocol — `POST /invocations`, session-id header, SSE response — is already correct.
- Rewriting CopilotKit or the 7-phase renderer contract.
- Citations UX / retrieval quality — covered by future Playwright Phase 2 spec.
- Production-scale CORS hardening beyond what the e2e + dev flows require. The allowed-origin list is enumerable and small in Phase 1.

## High-level decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Form factor | CloudFront reverse-proxy → AgentCore | Native SSE streaming; no Lambda in the hot path; AgentCore does JWT verification. |
| Auth model | AgentCore native Cognito JWT authorizer | `RuntimeAuthorizerConfiguration.usingCognito()` is already in the construct; browser already has a Cognito ID token. |
| CF placement | New behavior on the **existing** `investor-web` Distribution | Single CDN in front of frontend + agent API. Prod is same-origin; dev uses the absolute CF URL via runtime config. |
| URL rewriter | CloudFront Function (viewer-request) | String rewrite only (`/api/copilotkit*` → `/runtimes/<arn>/invocations?qualifier=DEFAULT`); 1ms budget is plenty; no cold start. |
| CORS | CF Response Headers Policy | Declarative, no code. Allowed origins = prod distribution domain + `http://localhost:4200` for dev/e2e. |
| Browser URL resolution | Absolute CF URL via `RuntimeConfigService` | Works identically in dev and prod. Decoupled from host origin. |
| Cross-stack wiring | SSM only | investor-web reads onboarding-bff's runtime-URL SSM export at deploy time. No direct CDK construct sharing. |
| Deploy order | onboarding-bff → investor-web | SSM export must exist before investor-web resolves the token. |

## Architecture

```
┌──────────────────┐     POST /api/copilotkit
│   onboarding-mfe │ ─── Authorization: Bearer <idToken> ───▶ ┌───────────────┐
│   (HttpAgent)    │     x-amzn-bedrock-agentcore-            │  CloudFront   │
└──────────────────┘     runtime-session-id: <tenant>/<sid>   │ (investor-web │
                                                               │  Distribution)│
                                                               └───────┬───────┘
                                                                       │  CF Function rewrites URI:
                                                                       │  /api/copilotkit* →
                                                                       │  /runtimes/<arn>/invocations?qualifier=DEFAULT
                                                                       ▼
                                                          bedrock-agentcore.us-east-1.amazonaws.com
                                                                       │  (Cognito JWT authorizer verifies token)
                                                                       ▼
                                                          ┌─────────────────────────┐
                                                          │  AgentCore Runtime      │
                                                          │  (Hono on port 8080,    │
                                                          │   POST /invocations)    │
                                                          └─────────────────────────┘
```

The request body (CopilotKit's JSON shape) passes through unchanged. The SSE response streams from container → AgentCore → CF → browser without buffering (CF cache policy `CachingDisabled`).

## Component changes

### 1. `services/investor/onboarding-bff/src/service.stack.ts`

Currently instantiates `AgentRuntime` without an authorizer (`.stack.ts:52-70`). Change:

- Import `UserPool` + `UserPoolClient` via SSM lookups (the ids that `investor-web` already publishes at `auth/userPoolId` and `auth/userPoolClientId`):
  - `UserPool.fromUserPoolId(this, 'InvestorUserPool', userPoolId)`
  - `UserPoolClient.fromUserPoolClientId(this, 'InvestorUserPoolClient', clientId)`
- Pass both into the existing `AgentRuntime` call:
  - `userPool: importedUserPool`
  - `userPoolClients: [importedClient]`
- No other changes in this stack. The `AgentRuntime` construct (agent-runtime.ts:60-67) already applies `RuntimeAuthorizerConfiguration.usingCognito(...)` when both props are present.

### 2. `services/investor/investor-web/src/service.stack.ts`

Add a second behavior to the existing `Distribution` (service.stack.ts:116-124). The distribution is already created for the SPA S3 origin; this adds a sibling behavior.

**New resources inside the stack:**

- `onboardingRuntimeArn` — `StringParameter.valueForStringParameter(this, '/nestfolio/${prefix}-onboarding-bff/agent/runtimeUrl')` (deploy-time token).
- `copilotRewriteFn` — `cloudfront.Function` with inline code:
  ```js
  function handler(event) {
    var req = event.request;
    req.uri = '/runtimes/' + encodeURIComponent('${ARN}') + '/invocations';
    req.querystring = { qualifier: { value: 'DEFAULT' } };
    return req;
  }
  ```
  where `${ARN}` is a CDK-token substitution that CFN resolves at deploy time. (CDK's `FunctionCode.fromInline(...)` does surface token substitution in CFN; the literal runtime ARN is the final rendered string.)
- `copilotOriginRequestPolicy` — custom OriginRequestPolicy forwarding:
  - Headers: `Authorization`, `Content-Type`, `x-amzn-bedrock-agentcore-runtime-session-id`
  - Cookies: none
  - Query strings: none (the CF Function supplies `?qualifier=DEFAULT`)
- `copilotResponseHeadersPolicy` — ResponseHeadersPolicy with CORS behavior:
  - Allowed origins: the distribution's own domain (prod same-origin), plus `http://localhost:4200` (dev/e2e host). Both via `accessControlAllowOrigins`.
  - Allowed methods: `POST`, `OPTIONS`
  - Allowed headers: `Authorization`, `Content-Type`, `x-amzn-bedrock-agentcore-runtime-session-id`
  - Exposed headers: `Content-Type` (default permits SSE `text/event-stream`)
  - Access-Control-Allow-Credentials: false (the Authorization header is used instead)
  - Origin override: true
- New behavior on the existing distribution via `distribution.addBehavior(...)`:
  - Path pattern: `/api/copilotkit*`
  - Origin: `new HttpOrigin('bedrock-agentcore.us-east-1.amazonaws.com')`
  - ViewerProtocolPolicy: `HTTPS_ONLY`
  - AllowedMethods: `ALLOW_ALL` (need POST)
  - CachePolicy: `CACHING_DISABLED`
  - OriginRequestPolicy: `copilotOriginRequestPolicy`
  - ResponseHeadersPolicy: `copilotResponseHeadersPolicy`
  - FunctionAssociations: `[{ function: copilotRewriteFn, eventType: VIEWER_REQUEST }]`

**Existing CSP concern.** `service.stack.ts:96` hardcodes `script-src 'self'` on the default behavior's `ResponseHeadersPolicy`. That policy is attached to the SPA behavior, not the `/api/copilotkit*` behavior, so the CSP does not apply to the proxied API response. **However**, the SPA's CSP also governs outbound fetches from the browser. If the browser is same-origin in prod (hits the same `cloudfront.net` domain), no CSP directive blocks it. If the browser runs at `localhost:4200` in dev and posts cross-origin to the sandbox CF, CSP is enforced by the *hosting page*, not by CF — so the dev page is not under the SPA CSP at all. No CSP change is required for dev or prod; flag for the plan to re-verify once a prod deploy lands.

**Stack dependency**: `this.addDependency(onboardingBffStack)` — but only if both stacks are composed into a single CDK app tree with a stack reference. If the app composition is per-service (each stack stand-alone), rely on deploy-order discipline (documented in the plan) and on `valueForStringParameter` returning a token that simply fails the `investor-web` deploy if the param is absent.

### 3. `apps/onboarding-mfe/src/app/onboarding/onboarding-chat.component.ts`

Three changes:

1. Replace `BFF_URL = '/api/copilotkit'` with a URL sourced from `RuntimeConfigService` (see §4).
2. Pass a `headers` factory to `HttpAgent` that returns:
   - `Authorization: Bearer <idToken>` — fetched via `fetchAuthSession()` each call so it respects Amplify token refresh.
   - `x-amzn-bedrock-agentcore-runtime-session-id: ${tenantId}/${sessionId}` where:
     - `tenantId` comes from `AuthStore.user().tenantId` (already verifier-trusted at boot).
     - `sessionId` is a UUID generated at first message and persisted in `sessionStorage` under a stable key (e.g. `onboarding.sessionId`) so renderer remounts do not reset it. One session per tab per run.
3. No change to the rest of the component — phase signals, renderer map, and the 7-phase contract stay identical.

### 4. Runtime config surface (libs/shell or nestfolio-host)

`RuntimeConfigService` (or the host's equivalent — `apps/nestfolio-host/src/app/app.config.ts` resolves runtime config at bootstrap via SSM) gets a new field:

- `copilotApiUrl: string` — `${investorWebDistributionUrl}/api/copilotkit`

Source: the existing SSM parameter `{investor-web-prefix}/web/distributionUrl`. No new SSM param needed.

The field is injected as an Angular DI token (new `COPILOT_API_URL` provider) and consumed by the onboarding chat component. Matches the pattern the host already uses for the AppSync endpoint.

## Security notes

### JWT trust boundary

AgentCore's Cognito authorizer verifies the ID token against the User Pool JWKS on every request. A request that reaches the container has a verified token. The container can re-parse the forwarded `Authorization: Bearer <jwt>` header for authoritative claims; current code does not, but its tools are observability-only, so no tenant boundary is crossed today.

The `x-amzn-bedrock-agentcore-runtime-session-id` header carries `${tenantId}/${sessionId}`. It is **client-provided** and not verified by AgentCore. In the current container code (`agents/onboarding/server.ts:67-69`) it is used solely for trace-envelope correlation, not for authorization. A follow-up hardening pass is recommended if any tool ever writes tenant-scoped data: the tool should prefer the verified JWT claim over the session-id field.

### CORS allowed origins

The allowed-origins list is explicit and short:
- Prod: `https://<investor-web-distribution>.cloudfront.net` (resolved deploy-time from the distribution's own `distributionDomainName`).
- Dev/e2e: `http://localhost:4200`.

No wildcards. No credentials mode. Authorization is header-only.

## Deploy ordering and cross-stack coupling

1. `onboarding-bff` deploys first — publishes `/nestfolio/${prefix}-onboarding-bff/agent/runtimeUrl` to SSM and enables the Cognito authorizer on the AgentCore runtime.
2. `investor-web` deploys second — reads the SSM parameter via `valueForStringParameter` (deploy-time token), builds the CF Function body with the ARN baked in, attaches the new behavior.

Ordering is a plan-level operational detail. Neither stack fails at synth if the other is absent; both simply produce placeholder tokens until both are deployed in the right order.

## Dev / e2e workflow

- Playwright runs investor-mfe + host on `localhost:4200–4205` (see the parent Playwright spec §"Canonical post-fix port table"). The browser's `RuntimeConfigService` is already seeded with sandbox SSM values (same path the Jest e2e uses via `@nestfolio/test-support`). `copilotApiUrl` resolves to the **sandbox** investor-web CF domain.
- CORS Response Headers Policy lists `http://localhost:4200` as an allowed origin — preflight succeeds.
- No local proxy, no dev-only Angular `proxy.conf.json`, no nginx sidecar.

## Testing

- **CDK unit tests** (existing pattern — see `services/investor/investor-web/test/`):
  - `investor-web` stack test: assert the second behavior exists with the expected path pattern, origin, origin-request policy, and response-headers policy.
  - `onboarding-bff` stack test: assert `RuntimeAuthorizerConfiguration.usingCognito` is applied to the runtime.
- **Integration test** (`services/investor/onboarding-bff/test/integration/`): no direct integration test for the bridge — the Playwright journey covers the end-to-end path. A unit test on the CF Function source (plain JS, pure function) asserts URI + querystring rewriting.
- **Playwright e2e**: the parent spec's `new-investor-happy-path` journey exercises the bridge on every run — steps 2–5 all hit it.

## Acceptance criteria

- [x] `onboarding-bff` deploys with Cognito authorizer on the AgentCore runtime. *(Verified 2026-04-22: `dev-onboarding-bff` deployed, runtime ARN `arn:aws:bedrock-agentcore:us-east-1:771924376645:runtime/onboarding_agent-YZ0LJhFVyA` published to SSM; unauthenticated POST through the CF bridge returns `HTTP/2 401 Missing Authentication Token`.)*
- [x] `investor-web` deploys with the `/api/copilotkit*` behavior, CF Function, origin-request policy, and CORS response headers policy. *(Verified 2026-04-22: `dev-investor-web` stack `UPDATE_COMPLETE`. Required a non-zero `CachePolicy.maxTtl` — CloudFormation rejects `HeaderBehavior` on policies where all TTLs are 0. Canonical fix per CloudFront docs: `maxTtl=1s` since POSTs are never cached regardless of policy.)*
- [x] `RuntimeConfigService` exposes `copilotApiUrl`; `onboarding-chat.component.ts` no longer hardcodes `/api/copilotkit`. *(Covered by prior commits `a50b5fcc` + `5bdf287c`.)*
- [ ] Browser posts succeed with `Authorization: Bearer <idToken>` — AgentCore accepts the JWT; container receives the request on `/invocations`. *(Deferred: requires interactive browser sign-in via Cognito.)*
- [ ] Response streams as SSE to the browser; CopilotKit's phase renderers mount as before. *(Deferred: same as above.)*
- [ ] `onboarding-bff` emits one `ONBOARDING_AGENT_INVOCATION_TRACED` envelope per invocation, `tenantId` and `correlationId` populated from the session-id header. *(Deferred: no invocation possible without a valid browser-issued JWT.)*
- [x] CORS preflight (OPTIONS) succeeds from `http://localhost:4200`. *(Verified 2026-04-22: `HTTP/2 200`, `access-control-allow-origin: http://localhost:4200`, allow-methods `POST,OPTIONS`, allow-headers echoes Authorization/Content-Type/x-amzn-bedrock-agentcore-runtime-session-id.)*
- [x] CF Function unit test asserts rewrite correctness for `/api/copilotkit`, `/api/copilotkit/`, and `/api/copilotkit?x=y`. *(See `services/investor/investor-web/test/unit/cf-functions/copilot-rewrite.test.ts`.)*
- [x] CDK stack tests assert the new behavior's path pattern, policies, and function association. *(See `services/investor/investor-web/test/unit/service.stack.test.ts`; 14 assertions green.)*

## Open questions / plan-level decisions

- **CF Function token substitution**: CDK's `cloudfront.Function.fromInline(...)` treats the code argument as a template-substituted string for CFN tokens. The plan must verify this behavior on the pinned CDK version (some CDK versions require `Fn.sub` around the inline source). If the token does not substitute, fall back to a `CfnFunction` with explicit `Fn.sub`.
- **Deploy-order enforcement**: whether to wire an explicit `stack.addDependency(...)` depends on how the CDK app composes stacks (single app vs per-service). Plan picks based on the existing `bin/nestfolio.ts` (or equivalent) composition.
- **Session-id lifetime**: `sessionStorage` loses the id on tab close. Acceptable for Phase 1 (journeys are single-tab). A future spec may move it to `localStorage` keyed by tenantId for cross-tab session persistence.
- **Prod origin list**: the Playwright spec runs against the sandbox; prod deploys will need additional allowed origins (custom domain, if any). The plan reads the distribution's actual domain at deploy time; any custom domain must be added explicitly.
- **Container hardening (follow-up, not this spec)**: if future onboarding tools write tenant-scoped DDB data, switch `parseRuntimeSessionId` to a JWT-claim-based extractor that reads the forwarded `Authorization` header. Tracked outside this spec.

## References

- Parent spec: [Playwright UI e2e — design](./2026-04-22-playwright-e2e-ui-design.md), §P3 and §"Pre-work — prerequisite fixes in existing code".
- `libs/cdk-constructs/src/extensions/agent-runtime.ts:48-73` — `AgentRuntime` construct, `authorizerConfiguration` branch.
- `services/investor/onboarding-bff/src/service.stack.ts:52-80` — AgentRuntime instantiation + SSM export of the runtime ARN.
- `services/investor/onboarding-bff/agents/onboarding/server.ts:60-99` — `POST /invocations` handler, session-id parsing, trace emission.
- `services/investor/investor-web/src/service.stack.ts:93-138` — existing Distribution + ResponseHeadersPolicy + SSM exports.
- `apps/onboarding-mfe/src/app/onboarding/onboarding-chat.component.ts:58` — the hardcoded URL to remove.
- CopilotKit `HttpAgent` (`@copilotkit/runtime-client-gql`) — accepts a `headers` factory, so request-scoped auth is supported without patching.
