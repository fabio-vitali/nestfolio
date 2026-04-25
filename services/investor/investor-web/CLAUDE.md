# investor-web

Domain: investor | Bus: InvestorBus
Stack: services/investor/investor-web/src/service.stack.ts

## State
None (frontend hosting + auth infrastructure)

## Infrastructure

### Cognito UserPool
- Name: `<prefix>-investor-user-pool`
- Email sign-in, auto-verify email
- MFA optional; password policy: 8+ chars, upper/lower/digits (no symbols required)
- Custom attribute: `tenant_id` (`custom:tenant_id`, immutable)
- AccountRecovery: email only
- Lambda triggers: PostConfirmation, PostAuthentication (direct synchronous invocation — scoped exception to 3-tier ingestion; see service.stack.ts comment)
- RemovalPolicy: RETAIN in prod, DESTROY otherwise

### Cognito WebClient
- Auth flows: userPassword + userSrp + adminUserPassword
- No client secret

### S3 AssetsBucket
- Shell static assets (S3-managed encryption, block all public access)
- BucketDeployment from `dist/apps/nestfolio-host/browser`; invalidates `/*` on deploy

### CloudFront Distribution
- Default behavior: S3Origin via OAI → shell SPA; HTTPS redirect; SPA routing (404 → /index.html 200)
- ResponseHeadersPolicy: CSP (single-sourced — see CSP section below), X-Frame-Options DENY, HSTS 2 yr + includeSubdomains, X-Content-Type-Options, Referrer-Policy strict-origin-when-cross-origin
- `/api/copilotkit*` behavior: HttpOrigin → `bedrock-agentcore.us-east-1.amazonaws.com`; viewer-request CopilotRewriteFn; custom CachePolicy (Authorization in cache key, maxTtl=1s); custom OriginRequestPolicy (Content-Type + x-amzn-bedrock-agentcore-runtime-session-id); CORS ResponseHeadersPolicy
- B1 behaviors (13 total, gated by `mfeBehaviors=true` context flag — see section below)

## CloudFront Distribution — B1 Unified Topology (gated by `mfeBehaviors=true`)

Charter §5 row 9a + §7 R6. When the CDK context key `mfeBehaviors` equals `'true'`, the stack
instantiates a shared `RealtimeRewriteFn` CloudFront Function and iterates `MFE_CATALOG` to add
**13 additional behaviors**:

| # | Path pattern | Origin | Notes |
|---|---|---|---|
| 5 | `/mfe/<key>/*` | S3BucketOrigin.withOriginAccessControl (SSM-discovered bucket) | CACHING_OPTIMIZED; GET/HEAD; consumes A3 OAC bucket policy |
| 4 | `/graphql/<domain>` | HttpOrigin → `<apiId>.appsync-api.<region>.amazonaws.com` | CACHING_DISABLED; ALL methods; viewer-request RealtimeRewriteFn |
| 4 | `/realtime/<domain>` | HttpOrigin → `<apiId>.appsync-realtime-api.<region>.amazonaws.com` | CACHING_DISABLED; ALL methods; viewer-request RealtimeRewriteFn |

`MFE_CATALOG` drives which behaviors are added. Entries with `hasFacade: false` (onboarding) receive
only the `/mfe/<key>/*` behavior — no `/graphql` or `/realtime` behavior.

### MFE_CATALOG (`src/mfe-catalog.ts`)
Single source of truth for wired BFFs. Consumed by:
- `service.stack.ts` at CDK synth time
- `tools/scripts/list-mfe-catalog.mjs` at deploy time (used by `deploy.sh` Phase 4a)

| key | service | hasFacade |
|---|---|---|
| investor | investor-bff | true |
| advisory | advisory-bff | true |
| ledger | ledger-bff | true |
| dashboard | dashboard-bff | true |
| onboarding | onboarding-bff | false |

### Cold-start deploy contract
1. **Phase 2 (cold start)**: deploy investor-web with `mfeBehaviors=false` (default). BFF SSM exports
   (`mfe/bucketName`, `api/apiId`) do not yet exist — flag omitted avoids synth-time SSM lookup failure.
2. **Phase 2+ (BFF deploy)**: each BFF deploys and publishes `mfe/bucketName` and (if Facade-bearing)
   `api/apiId` SSM exports.
3. **Phase 4a (re-deploy)**: `deploy.sh` re-deploys investor-web with `-c mfeBehaviors=true` after all
   BFFs are deployed. The 13 B1 behaviors are wired. Steady-state deploys keep the flag `true`.

## Cognito Triggers (direct Lambda, not via Ingress)

Synchronous 5s timeout; must return to Cognito to complete auth flow. 3-tier ingestion
(EB Rule → SQS → Lambda) does not apply. Errors propagate atomically to fail the trigger.

- **PostConfirmation** (`post-confirmation.ts`): generates `tenantId` (UUID); sets `custom:tenant_id`
  via AdminUpdateUserAttributes; emits `USER_REGISTERED` to InvestorBus (standard envelope,
  source `${BUS_NAME}@investor-web`). Fails trigger if PutEvents returns FailedEntryCount > 0.
- **PostAuthentication** (`post-authentication.ts`): reads `custom:tenant_id` from user attributes;
  emits `USER_AUTHENTICATED` to InvestorBus only when `tenantId` is present (skips social/federated
  users without the attribute). Same fail-hard contract.

## SSM Parameters Published

- `auth/userPoolId`
- `auth/userPoolClientId`
- `auth/region`
- `web/distributionUrl`
- `web/distributionId`  ← consumed by A3 OAC wiring in BFF stacks (MfeBucket)

## SSM Parameters Consumed

- `/nestfolio/<prefix>-onboarding-bff/agent/runtimeUrl` — Bedrock AgentCore runtime ARN; read at deploy
  time via `StringParameter.valueForStringParameter`; substituted into copilot-rewrite.js via `Fn.sub`.
  Deploy-order contract: onboarding-bff must be deployed before investor-web.
- `/nestfolio/<prefix>-<service>/mfe/bucketName` × 5 BFFs — consumed when `mfeBehaviors=true`
  (provisioned by A3's `MfeBucket` extension construct in each BFF stack).
- `/nestfolio/<prefix>-<service>/api/apiId` × 4 facade-bearing BFFs — consumed when `mfeBehaviors=true`
  (exported by each BFF's `Facade` construct via `api/apiId`).

## CSP

- **Source of truth**: `apps/nestfolio-host/csp.txt` (charter §5 row 8, Pillar 5; A1)
- Read at synth time via `readFileSync`; applied to CloudFront via `ResponseHeadersPolicy.contentSecurityPolicy`
- `synth` Nx target lists `apps/nestfolio-host/csp.txt` in `inputs` for affected tracking
- Inline script hash `NxFByHVehWCRp13zII+PkyEbL0FVXOumU3tgjZaLf9U=` covers the federation runtime
  esms-options block (Pillar 5)

## CloudFront Functions

- **`copilot-rewrite.js`** (viewer-request on `/api/copilotkit*`): rewrites URI to
  `/runtimes/<arn>/invocations?qualifier=DEFAULT`. `__RUNTIME_ARN__` placeholder substituted at
  deploy time via `Fn.sub` with the onboarding-bff SSM-resolved ARN.
- **`realtime-rewrite.js`** (viewer-request, shared across all 8 graphql + realtime behaviors):
  matches `/realtime/<domain>` or `/graphql/<domain>` and rewrites to `/graphql`. Idempotent —
  bare `/graphql` (already-rewritten) is not matched.

## Handlers

- `post-confirmation.ts` — Cognito PostConfirmation trigger; generates tenantId; sets
  `custom:tenant_id`; emits `USER_REGISTERED`
- `post-authentication.ts` — Cognito PostAuthentication trigger; emits `USER_AUTHENTICATED`
  (only when `custom:tenant_id` is present)

## Tests

- `test/unit/handlers/post-confirmation.test.ts`
- `test/unit/handlers/post-authentication.test.ts`
- `test/unit/cf-functions/copilot-rewrite.test.ts`
- `test/unit/cf-functions/realtime-rewrite.test.ts`
- `test/unit/mfe-catalog.test.ts`
- `test/unit/service.stack.test.ts`

## Dependencies

- libs: `@nestfolio/cdk-constructs/core`, `@nestfolio/cdk-constructs/utils`, `@nestfolio/event-processor`
- AWS SDKs: `@aws-sdk/client-eventbridge`, `@aws-sdk/client-cognito-identity-provider`
- Nx tags: `scope:investor`, `type:web`
