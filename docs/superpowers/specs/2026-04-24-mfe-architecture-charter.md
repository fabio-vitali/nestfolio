# MFE architecture — charter

**Status:** Proposed
**Author:** fabio-vitali + Claude
**Date:** 2026-04-24
**Type:** Charter (architectural baseline). Higher-order than a design or remediation spec — establishes the invariants every future frontend-side spec must conform to.

## 1. Context

The micro-frontend system grew without an explicit charter. Boundary calls (shell vs MFE vs lib vs infra-owner, who provisions what, how apps discover backend resources, what crosses domain lines) were settled per-PR. The accumulated ambiguity surfaced as a bug class — most recently the shell-render-broken family of issues — that no individual fix could address without a baseline to refer to.

This document is the baseline. It does not prescribe an implementation; it establishes the *constraints* every implementation must satisfy. The 2026-04-23 shell-render-restoration design becomes informational — captured the symptoms; this charter captures the principles. Any remediation that follows is a *local application* of this charter, not a substitute for it.

## 2. Problem

Concretely, three classes of problem this charter exists to prevent:

- **Silent boundary erosion.** Without a charter, an MFE can quietly start importing from a sibling MFE, or a BFF can quietly start owning shared infrastructure. Each such drift is locally rational; their accumulation is not.
- **Discovery via convention rather than declaration.** Backend resource references end up in `environment.ts`, in tsconfig paths, in CDK stack outputs read across stack boundaries. The single source of truth diffuses; rebuilds become coupled in non-obvious ways.
- **Ambiguous ownership of cross-cutting concerns.** Auth, theme, runtime config, federation contract — every one of these has lived in 2-3 places at different times. The single owner per concern is the load-bearing call this charter makes.

## 3. Goals and non-goals

### Goals

The five pillars in §4. Each pillar is non-negotiable; the lower-level rules in §5–§8 derive from them.

### Non-goals

- **Native Federation v4 migration.** v21.2.x is the federation runtime baseline. Migration is a future spec.
- **Renaming `investor-web`.** The infra-owner service keeps its current name. Cognito remains co-located there because Cognito triggers emit to InvestorBus.
- **Domain realignment of existing services.** No backend service moves between domains as part of this charter.
- **Vendor selection for observability, error reporting, feature-flag store backend.** Those are concrete picks belonging to their own specs. This charter only names the layer that owns each concern.
- **Enumerating current-code violations.** The migration plan from current state to charter-conformant state is a separate document. This spec does not list which files break which rule today.

## 4. The five pillars

Each pillar has: a one-line statement, the rationale (why we accept the costs), the invariants it generates (lower-level rules that fall out trivially), and what it explicitly does *not* imply (preventing scope creep into adjacent decisions).

### Pillar 1 — Independence

**Statement:** Each domain (MFE + its BFF) deploys on its own cadence with no coordination from any other domain.

**Rationale:** The product reason MFEs exist at all (settled in brainstorming): per-domain teams ship without rebuilding sibling apps. Lockstep deploy is a regression to monolith.

**Invariants:**
- Per-app `build` and `deploy` Nx targets. No central deploy orchestrator.
- Federation manifest is per-MFE updatable; one MFE deploy never requires rebuilding any other.
- No "deploy in this order" coupling. No compatibility matrix.
- The only deploy-time coupling permitted is **MFE catalog change** (adding/removing an MFE/BFF requires re-deploying `investor-web` so CloudFront learns the new origin). This is a workspace-level event, not a per-team-deploy event.

**Does not imply:** independent *framework versions* per MFE — that's iframes, not federation (see Pillar 2). Independent *infrastructure* per MFE — that contradicts Pillar 5.

### Pillar 2 — Isolation

**Statement:** Apps are sealed builds. The federation runtime plus a declared singleton surface are the only inter-app contracts.

**Rationale:** A clean contract surface is the only thing that survives team-independent evolution under Pillar 1. Any other coupling (cross-app source imports, transitive dependency leaks) is a time bomb.

**Invariants:**
- No tsconfig path lets app A import from app B's source.
- No app `loadRemoteModule`s another app at runtime except the shell loading MFEs.
- The singleton surface (the union of all packages declared `singleton: true` in `federation.config.js`) is a *single declared module*: `@nestfolio/frontend-deps`. Every app's federation config requires it. The shell's set must be a *superset* of every MFE's set; this is enforced mechanically, not by convention.
- One framework, one major version, workspace-wide.

**Does not imply:** workspace libs are forbidden — they remain the build-time sharing mechanism (UI primitives, types, utilities). Singletons are the *runtime* sharing mechanism. The two roles do not overlap.

### Pillar 3 — Discovery

**Statement:** Every backend resource reference (dev and prod) is fetched from SSM at pre-build time. Source code is environment-blind.

**Rationale:** `environment.ts`-baked URLs and IDs were the root cause of multiple shipped-blank-page incidents. Removing them as a category is cheaper than enforcing them by review.

**Invariants:**
- No `environment.ts` resource literals. The file may exist for *structural* defaults (feature toggles, dev-only debug flags) but contains no URLs, ARNs, IDs, or endpoints.
- Build pipeline order: `config → build → deploy` (see §8). Even local dev with `nx serve` runs `config` first.
- Production config and dev config are produced by the *same script* against different SSM prefixes. No code path is "for production only."
- Bootstrap discipline corollary: any service consuming runtime-config values must inject them via *factory*, not eagerly capture at provider-setup time. Eager capture is what makes a missing config silently bind to placeholder values.

**Does not imply:** offline development is supported. Local dev requires AWS read credentials (Leapp). An offline snapshot file is a possible future escape hatch, not a charter requirement.

### Pillar 4 — Composition

**Statement:** The shell is the composition root. MFEs are sealed feature subtrees. Cross-cutting concerns have a single owner.

**Rationale:** Multiple owners for one concern (auth in 3 places, theme in 2) was the source of the ambiguity this charter was written to remove. One owner per concern is the load-bearing call.

**Invariants:**
- Shell owns: top-level routing, auth wiring, theme application, runtime-config bootstrap, the canonical CSP source file, per-route error boundaries, navigation service.
- MFE owns: only its own route subtree. An MFE that wants to render outside its subtree calls the shell-provided NavigationService.
- Per-route failure isolation: an MFE failing to load shows a contained error boundary, not a blank page.
- Cross-cutting concerns (observability, i18n, feature flags, Apollo factory) live in workspace-lib singletons; the shell wires them; MFEs consume via DI tokens.

**Does not imply:** the shell has UI of its own beyond the composition primitives (router outlet, error boundary frame, optionally a global notifications panel). Domain UI never lives in the shell.

### Pillar 5 — Security

**Statement:** Same-origin everything. Strict CSP from a single source of truth. Auth centralized.

**Rationale:** Same-origin eliminates an entire CORS surface, simplifies CSP, simplifies cookie scoping. Single-source-of-truth CSP eliminates the silent-disagreement bug class (today the meta tag and CloudFront header drift; whichever is stricter wins, violations against the looser one are silent).

**Invariants:**
- Shell + every MFE + every BFF (HTTP and WebSocket) are reachable on one origin via the single CloudFront distribution.
- One canonical CSP file (`apps/nestfolio-host/csp.txt`). The HTML meta tag and the CloudFront `ResponseHeadersPolicy` both *read* it; never two strings.
- No `unsafe-inline`. Required inline scripts (e.g. the federation runtime's `esms-options`) are sha256-hashed. The hash is verified by a build-time assertion so silent regressions fail the build.
- Auth is centralized in the shell. MFEs consume an auth context via DI; they never call Cognito directly.

**Does not imply:** per-MFE origin isolation. The trade-off was considered and rejected in brainstorming — same-origin's simplicity beat per-MFE's stronger browser-level isolation for this product.

## 5. Layer-ownership matrix

Layers: `shell-app` (the host), `MFE-app` (each of N), `workspace-lib` (libs in `libs/`), `infra-owner-service` (the CDK stacks owning frontend infra).

| # | Concern | Owner | Notes |
|---|---|---|---|
| 1 | Identity provisioning (Cognito user pool, triggers) | `investor-web` | Cloud resource; CDK stack creates it; SSM-exports user-pool IDs. |
| 2 | Identity runtime (signIn, token refresh, auth context) | workspace-lib singleton (`@nestfolio/shell/auth`); shell wires it | MFEs depend on the lib, never on the shell app. |
| 3 | Top-level routing (path-prefix → MFE) | `shell-app` | Composition root knows the full route map. |
| 4 | Internal routing (within an MFE's subtree) | `MFE-app` | MFE never claims paths outside its prefix; conflicts are build-time errors. |
| 5 | Runtime config (fetch `config.json`, provide via DI) | `shell-app` fetches; `workspace-lib` exposes consumption hooks | One fetch at bootstrap, one shape, factory-injected. |
| 6 | Theme + UI primitives | workspace-lib (`@nestfolio/ui`) | Build-time sharing per Pillar 2. |
| 7 | Federation contract (singleton surface declaration, manifest schema) | workspace-lib (`@nestfolio/frontend-deps`) | One file controls drift; every app's federation.config requires it. |
| 8 | Browser security source (CSP file) | `shell-app` | Canonical text file; the *string* lives here. |
| 9a | Frontend hosting infra: Cognito + CloudFront + shell bucket + shell deploy + CSP delivery + CopilotKit CF Function + SSM exports of distribution ID and Cognito IDs | `investor-web` | The single CloudFront distribution; origins for all MFE buckets and BFF endpoints discovered via SSM. |
| 9b | Per-MFE S3 bucket + bucket policy granting CloudFront OAC + SSM exports of `{bucketName, graphqlUrl, realtimeUrl}` | each `<domain>-bff` | Vertical-slice ownership: the team owning the BFF owns its MFE's hosting bucket and its API endpoints. |
| 10 | Build + deploy pipeline (per-app `build` and `deploy` targets) | each app | Deploy reads bucket name from SSM (provisioned by the BFF stack); no central orchestrator. |
| 11 | Cross-cutting singletons (observability, i18n, feature flags, Apollo factory) | workspace-libs (singletons); shell wires; MFEs consume | Each is a declared member of the singleton surface (#7). Vendor picks deferred to per-concern specs. |

**Out of this matrix:** backend BFFs (their domain logic, their data model, their event topology — all governed by backend specs, not this charter).

## 6. Per-app charter

Format: each app has a one-line **IS** (sole responsibility) and an explicit **IS NOT** (what stops scope creep). The IS NOT lines are load-bearing.

### `nestfolio-host` (shell)

- **IS** the composition root. Owns top-level routing, auth wiring, theme application, runtime-config bootstrap, the canonical CSP file, per-route error boundaries, the NavigationService singleton.
- **IS NOT** a feature host. No domain UI. No BFF calls. No AppSync wiring. Renders `<router-outlet>`; everything else is delegation.

### `investor-mfe`

- **IS** investor-domain UI (portfolio, holdings, transactions, account settings). Reads `investor-bff` only via Apollo client built with `/graphql/investor` + `/realtime/investor`.
- **IS NOT** auth, top-level routing, or anything outside `/investor/*`. Does not call any non-investor BFF.

### `advisory-mfe`

- **IS** advisory-domain UI (decision packets, scenarios, narrative review). Reads `advisory-bff` only.
- **IS NOT** same exclusions as investor-mfe.

### `ledger-mfe`

- **IS** ledger-domain UI (positions, NAV, accounting views). Reads `ledger-bff` only.
- **IS NOT** same exclusions.

### `dashboard-mfe`

- **IS** dashboard UI (system-state KPIs, cross-domain visualizations). Reads `dashboard-bff` only — which serves *prepared* cross-domain data on the backend.
- **IS NOT** a writer; not a navigation shell; not a generic BI tool consuming arbitrary BFFs.

### `onboarding-mfe`

- **IS** onboarding wizard UI (CopilotKit chat, LangGraph state visualization). Talks to `onboarding-bff` via the `/api/copilotkit*` bridge.
- **IS NOT** any post-onboarding feature. Re-onboarding is a separate route, not a separate MFE.

### `investor-web` (CDK infra-owner service)

- **IS** the CDK stack provisioning shared frontend infra: Cognito user pool + triggers, the single CloudFront distribution (with origins for all MFE buckets and all BFF GraphQL/realtime endpoints, all SSM-discovered), the shell's S3 bucket, shell deploy pipeline, `ResponseHeadersPolicy` (reads canonical CSP file), CopilotKit CloudFront Function, SSM exports of distribution ID + Cognito IDs.
- **IS NOT** any application code. Not any *MFE* bucket (those belong to BFFs). Not a runtime-config writer (apps own that via their `config` target). Not a deploy orchestrator for app code other than the shell.

### Each `<domain>-bff` service

- **IS** a vertical-slice service: backend Lambda + AppSync API + DynamoDB + S3 bucket hosting its MFE bundle + bucket policy granting CloudFront OAC + SSM exports of `{bucketName, graphqlUrl, realtimeUrl}` + deploy pipeline for both backend infra and MFE bundle.
- **IS NOT** any frontend application code (that's the MFE app). Not CloudFront management (that's `investor-web`). Not Cognito. Not any cross-domain data preparation (that's `dashboard-bff` exclusively).

## 7. Cross-app communication rules

### R1 — MFE-to-MFE: forbidden (build-time and runtime)

No MFE may import from another MFE's source (Pillar 2 already implies). No MFE may `loadRemoteModule` another MFE. MFEs are sealed leaves; only the shell composes them.

### R2 — MFE-to-BFF: own-domain only

Each MFE talks to its own-domain BFF *exclusively* via that BFF's GraphQL endpoint and subscription channel. `investor-mfe` → `investor-bff`. `advisory-mfe` → `advisory-bff`. Etc. Cross-domain reads are served by `dashboard-bff` (which pre-aggregates) and consumed only by `dashboard-mfe`. Mirrors the backend "events only between services" rule and the BFF-as-CQRS-read-side rule.

### R3 — MFE-to-shell: only via the singleton contract

MFEs consume auth context, NavigationService, theme, runtime-config, feature flags via DI tokens exposed by `@nestfolio/shell/*` libs (singletons declared in `@nestfolio/frontend-deps`). MFEs never import `nestfolio-host` source — that would invert the composition.

### R4 — Cross-MFE navigation: via shell-provided `NavigationService`

"From investor view, open this advisory packet" = MFE calls `nav.go('/advisory/packets/123')`. The shell's top-level router resolves it; the target MFE lazy-loads. No deep-import, no postMessage, no event bus.

### R5 — Cross-MFE shared state: bounded

Only what's in runtime-config + auth context (user identity, current tenant, locale, feature flags, theme) is shared frontend state. Anything *domain-specific* that two MFEs both need goes server-side: it's a `dashboard-bff` query, not frontend shared state. If two MFEs would both need a piece of state, that's a signal the state belongs in `dashboard-bff`'s read model.

### R6 — Unified CloudFront topology (extends R2)

The same "BFF defines, `investor-web`'s CloudFront proxies via an SSM-discovered origin" pattern extends to GraphQL endpoints exactly as it does to S3 buckets.

| Path | CloudFront origin | Owner of origin definition |
|---|---|---|
| `/*` (default) | shell S3 bucket | `investor-web` |
| `/mfe/<key>/*` | that MFE's S3 bucket | that BFF (CDK + bucket policy + SSM export) |
| `/graphql/<domain>` | that BFF's AppSync HTTP endpoint | that BFF (AppSync API + SSM export of URL) |
| `/realtime/<domain>` | that BFF's AppSync WSS endpoint | that BFF (SSM export of realtime URL) |
| `/api/copilotkit*` | `onboarding-bff` CopilotKit endpoint | `onboarding-bff` (CF Function rewrite) |

**Apollo client topology:** N clients — one per MFE — each instantiated with relative paths `/graphql/<domain>` and `/realtime/<domain>`. Reinforces R2 mechanically: an MFE's Apollo client physically cannot reach another BFF.

**CSP consequence:** `connect-src 'self'` covers everything. No `*.amazonaws.com`, no `*.appsync-api.*`, no `wss://*.appsync-realtime-api.*` in the policy. (Subject to §9 verification item.)

**WSS-through-CloudFront mechanism:**
1. CloudFront WebSocket support is automatic on HTTP/HTTPS behaviors (no toggle).
2. Cache policy `CachingDisabled`. Origin request policy `AllViewerExceptHostHeader` (CloudFront sets `Host` to the origin's hostname, which is what AppSync needs).
3. CloudFront Function (viewer-request) rewrites `/realtime/<domain>` → `/graphql` before forwarding to the AppSync WSS origin. Same pattern as the existing CopilotKit rewrite.
4. Cognito JWT auth flows in the `?header=<base64>` query-string param (browser limitation; AppSync reads auth from query string on WS open).

**AppSync IAM auth note:** IAM-signed (SigV4) AppSync calls are server-to-server only (event-listener Lambda → AppSync subscription publishing on async cross-service completion). No browser code uses IAM auth. Therefore CloudFront proxying does not affect IAM auth at all — IAM calls do not transit CloudFront.

## 8. Runtime configuration

### Producer

An Nx `config` target on the **shell only**:

```
pnpm nx run nestfolio-host:config --stage=<stage> --region=us-east-1
```

A script (`scripts/fetch-runtime-config.sh`) reads SSM at the canonical prefix and writes `apps/nestfolio-host/public/assets/config.json`. Gitignored. Re-runs whenever stage switches.

### SSM path convention

```
/nestfolio/<stage>/<subsystem>/<resource>
```

Stage is its own path segment. Examples:
- `/nestfolio/dev/investor/auth/userPoolId`
- `/nestfolio/staging/investor/auth/userPoolClientId`
- `/nestfolio/prod/investor/auth/region`

This is a *forward-looking* convention. Current code uses `/nestfolio/<stage>-<subsystem>/<resource>` (hyphenated). Migration is a separate plan (out of scope for this charter); current code is legacy debt to be itemized then.

### Pipeline order (every workflow, including local dev)

```
config  →  build  →  deploy
```

For dev: `nx run nestfolio-host:config --stage=dev && nx serve nestfolio-host`. There is no `environment.ts` resource literal anywhere — Pillar 3 fully realized.

### Payload shape (after R6 unification)

```json
{
  "auth": {
    "region": "us-east-1",
    "userPoolId": "...",
    "userPoolClientId": "..."
  }
}
```

Three fields. Everything else is path-conventional:
- BFF queries: `POST /graphql/<domain>` (Apollo per-MFE client built from `<domain>` literal).
- BFF subscriptions: `wss://<origin>/realtime/<domain>`.
- CopilotKit bridge: `/api/copilotkit`.
- Asset URLs: relative.

### MFE consumption

MFEs do **not** have a `config` target. They consume the shell-fetched config via DI tokens exposed by `@nestfolio/shell/auth` (`AUTH_CONFIG`) and `@nestfolio/shell/graphql` (Apollo factory accepting a `<domain>` literal). One fetch, one shape, shared across the running app.

### Bootstrap discipline (Pillar 3 corollary)

Any service consuming runtime-config values must inject them via *factory*, not eagerly capture at provider-setup time:

```ts
// Wrong — eager capture, beats the APP_INITIALIZER fetch:
provideAuth(environment.auth),

// Right — factory injection, runs after loadRuntimeConfig has populated runtimeConfig:
{ provide: AUTH_CONFIG, useFactory: () => getRuntimeConfig().auth },
provideAuth(),  // reads AUTH_CONFIG from DI
```

Eager capture against placeholder `environment.ts` values is what makes a deployed shell silently authenticate against a nonexistent Cognito pool. The charter forbids it; reviewers must catch it.

### Adding a stage

Create the SSM parameters at `/nestfolio/<new-stage>/investor/auth/*`. No code change.

### Adding a runtime-config field

One SSM param + one line in `fetch-runtime-config.sh` + one type addition in `RuntimeConfig`. MFEs consuming via DI token need no rebuild if they don't read the new field.

## 9. Verification items for the implementation plan

The charter is design-complete; two items need a concrete spike before any plan can commit to it.

### V1 — AppSync WSS subscription through CloudFront

**Goal:** confirm the unified-topology row `/realtime/<domain>` works end-to-end with a real AppSync subscription.

**Approach:** one standalone test page (or a throwaway MFE) opens a subscription to a real BFF AppSync API through the CloudFront `/realtime/<domain>` path. Assert: `graphql-ws` handshake completes, a published mutation triggers a subscription payload received by the client.

**Risk if it fails:** the topology table grows one exception row — `/realtime/<domain>` becomes a direct WSS to AppSync, and CSP `connect-src` re-admits `wss://*.appsync-realtime-api.*.amazonaws.com`. Pillar 5's "same-origin everything" weakens to "same-origin except subscriptions." Charter survives; CSP wording in §7 changes.

**Effort:** ~30 minutes of plumbing + a quick browser verification.

### V2 — AppSync IAM auth: confirmed non-issue

**Status:** resolved during charter brainstorming. AppSync IAM auth is used server-to-server only (event-listener Lambda publishing to AppSync subscriptions when async cross-service work completes). No browser code uses IAM auth. CloudFront proxying does not affect IAM auth because IAM calls do not transit CloudFront.

**No spike required.** Listed for traceability.

## 10. What this obsoletes

- **`docs/superpowers/specs/2026-04-23-shell-render-restoration-design.md`** becomes informational. Its symptom analysis remains valuable; its specific remediations may or may not survive contact with this charter. Any future remediation plan derived from that spec must reference and conform to this one.
- **All current code** that violates a pillar is *legacy debt*. This charter does not enumerate violations or prescribe a migration path — that is a separate document (an explicit "MFE charter migration plan") that future work will produce.
- **Future frontend specs** start from this charter as a baseline. A spec that proposes an exception to a pillar must justify the exception and amend the charter; it cannot silently override one.

## 11. References

### This workspace

- `CLAUDE.md` — workspace skill router; the backend "Hard Constraints" section is the analog this charter mirrors on the frontend side.
- `memory/feedback_no_api_between_services.md` — the backend "events only" rule that R2 + R6 mirror on the frontend.
- `memory/feedback_bff_is_read_model.md` — the rule that grounds R5's "shared state belongs server-side" position and `dashboard-bff`'s charter as the cross-domain reader.
- `memory/feedback_no_deprecation.md` — context for §10's stance on legacy debt: dev is disposable, breaking changes are free.
- `docs/superpowers/specs/2026-04-23-shell-render-restoration-design.md` — predecessor (informational; see §10).

### External

- `node_modules/.pnpm/@angular-architects+native-federation@21.2.1/.../src/utils/updateIndexHtml.js` — federation runtime post-build inline script injection (relevant to Pillar 5's CSP hash).
- `node_modules/.pnpm/@softarc+native-federation@3.5.4/.../src/lib/config/federation-config.d.ts` — shared package configuration shape (relevant to Pillar 2's singleton surface).
- AWS CloudFront WebSocket support (general availability since 2018) — relevant to V1.
- AWS AppSync subscription protocol (`graphql-ws` subprotocol with `?header=<base64>` auth) — relevant to V1's CloudFront Function rewrite mechanism.
