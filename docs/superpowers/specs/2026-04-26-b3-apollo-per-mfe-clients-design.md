# B3 — Apollo per-MFE clients — design

**Date:** 2026-04-26
**Status:** Brainstormed; pending implementation plan.
**Roadmap reference:** [`docs/superpowers/plans/2026-04-24-mfe-charter-migration-roadmap.md`](../plans/2026-04-24-mfe-charter-migration-roadmap.md) §B3.
**Charter sections realized:** [`docs/superpowers/specs/2026-04-24-mfe-architecture-charter.md`](./2026-04-24-mfe-architecture-charter.md) §5 row 11, §7 R6 (Apollo-topology paragraph), §8 (post-R6 payload shape), Pillar 2.
**Depends on (shipped):** A1 (CSP single-source), A2 (`@nestfolio/frontend-deps` lib), A3 (per-BFF MFE bucket + `api/realtimeUrl` SSM exports), A4 (runtime-config producer + auth factory injection), B1 (CloudFront unified topology — `/graphql/<domain>` and `/realtime/<domain>` behaviors live).
**Depends on (in flight):** B2 (`feat/b2-federation-mechanical-fixes` — `aws-appsync-{auth,subscription}-link` already declared as singletons in `frontend-deps`; `@nestfolio/shell/graphql` already in `sharedMappings`). B3 cuts from `main` after B2 merges.
**Branch:** `feat/b3-apollo-per-mfe-clients`.

---

## 1. Problem

Today every browser-side GraphQL call resolves to an absolute AppSync URL baked into the runtime-config payload (`appsync.{investorBff, advisoryBff, dashboardBff, ledgerBff}.{endpoint, region}`). The wiring works, but four invariants the charter promises are not yet enforced:

1. **§7 R6** — under the unified CloudFront topology, MFEs reach BFFs via relative `/graphql/<domain>` and `/realtime/<domain>` paths only. Today they reach `https://<api-id>.appsync-api.<region>.amazonaws.com/graphql`.
2. **§5 row 11** — the Apollo factory is a workspace-lib singleton. Today the factory function is private inside `libs/shell/src/graphql/graphql.service.ts`, and its DI helper (`provideGraphqlFor`) lives in the host app at `apps/nestfolio-host/src/app/provide-graphql.ts`. MFEs cannot construct a client in standalone dev without copying that helper.
3. **§8 (post-R6 payload shape)** — runtime config carries `{auth: {region, userPoolId, userPoolClientId}}` only. Today it also carries an `appsync.*` block whose only live fields are `endpoint` (made dead by R6) and `region` (duplicates `auth.region`).
4. **Pillar 2** — an MFE physically cannot reach another BFF. With absolute URLs in the runtime payload this is enforced by convention only; with relative `/graphql/<domain>` URLs hard-coded against a literal `<domain>` per route, it becomes mechanical.

Secondary correctness gap surfaced by the brainstorm: the current Apollo client has **no central error link**, so a 401/403 from CloudFront/AppSync (token expired, signed out elsewhere) propagates only to the per-call caller; nothing triggers logout. The `LogoutOrchestrator` registered in `GraphqlService` only resets the client on already-initiated logout — it does not detect auth failures.

V1 spike result (charter §9 V1): WSS-through-CloudFront verified PASS using `aws-appsync-subscription-link@4.0.1` against a CloudFront-proxied URL. B3 inherits the verified protocol.

---

## 2. Goals

- The factory in `@nestfolio/shell/graphql` is the single construction site for browser-side Apollo clients targeting BFF domains.
- HTTP requests target `'/graphql/<domain>'` (relative). Subscriptions target `'${window.location.origin}/realtime/<domain>'` (absolute, so `aws-appsync-subscription-link`'s `https→wss` rewrite produces the right URL; the `appsync-api→appsync-realtime-api` rewrite is a no-op when neither token is present, leaving host/path intact).
- One Apollo client per `<domain>` per route activation, scoped by Angular's hierarchical injector.
- A central `errorLink` triggers logout via `LogoutOrchestrator` on 401/403 from network errors and on `extensions.code === 'UNAUTHORIZED'` from GraphQL errors.
- Runtime config payload reduces to charter §8 verbatim: `{auth: {region, userPoolId, userPoolClientId}, copilotApiUrl}`. The `appsync` block disappears from the type, the producer, and `validateEndpoints`.
- All eight MFE service files (`dashboard.service.ts`, `deposit.service.ts`, `notification.service.ts`, `advisory.service.ts`, `comparison.service.ts`, `time-travel.service.ts`, plus their two test fixtures) consume `GraphqlService` unchanged. The DI symbol they inject is identical; only the providers wired upstream change.
- `pnpm nx serve nestfolio-host` against a `--prefix=dev` runtime-config produces a Network panel showing `POST /graphql/<domain>` and `WS /realtime/<domain>` per route, no `*.amazonaws.com` calls.

---

## 3. Non-goals

- onboarding-mfe Apollo wiring. onboarding-bff has no Facade and no `api/*` SSM exports (memory: documented exception). onboarding-mfe drives CopilotKit via `/api/copilotkit*` (already proxied by B1's CF Function), not Apollo. B3 leaves it untouched.
- Migrating server-side AppSync clients. e2e-feature-tests, integration-testing, and event-listener Lambdas use direct AppSync URLs deliberately (Pillar 5: SigV4 IAM auth, server-to-server, never transits CloudFront).
- Removing `aws-amplify` itself. The Cognito user-pool integration (`fetchAuthSession`, `signIn`, `signOut`) stays exactly as A4 shipped it.
- New observability/tracing in the Apollo link chain. Out of scope.
- Subscription-link replacement. V1 PASS settled the lib choice; the only B3 question was URL composition.
- CSP `connect-src` tightening. A1 already shipped the canonical CSP file. Once B3 lands, no MFE code reaches AppSync directly, so the CSP is already tighter than required — no charter follow-up needed in B3.
- Per-MFE `aws-appsync-subscription-link` lazy loading. The lib is already a federation singleton (`includeSecondaries: true` in `frontend-deps`); per-client lazy loading would be premature optimization.

---

## 4. High-level decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Factory shape | Free function `createApolloClient(opts)`; `GraphqlService` keeps its public surface and builds its inner client via the factory | Smallest blast radius — eight MFE service files don't move. The wrapper preserves test-mock ergonomics and `LogoutOrchestrator` registration. |
| Subscription transport | `aws-appsync-subscription-link@4.0.1` against `${window.location.origin}/realtime/<domain>` | V1 PASS verified protocol; lib is already a federation singleton. Custom WSS link rejected as needless reinvention. |
| Runtime-config scope | Delete `RuntimeConfig['appsync']` entirely (type, validation, producer SSM lookups, JSON output) | Charter §8 verbatim. Keeping a "two sources of region" duplicate (`appsync.*.region` + `auth.region`) invites drift; the producer also stops querying 4 BFF SSM paths (faster bootstrap). |
| Error link | Add `errorLink` to factory; logs out on `networkError.statusCode === 401\|403` or `graphQLErrors[].extensions.code === 'UNAUTHORIZED'` | Closes a real correctness gap (token expiry / signed-out-elsewhere doesn't propagate today). Logout-on-error sits at the link chain so every MFE inherits it without touching service code. |
| DI helper home | Move to `@nestfolio/shell/graphql`, rename `provideMfeGraphql(domain)` | Charter §5 row 11 puts cross-cutting DI helpers in workspace-libs. MFEs can use the helper in standalone dev harnesses. |
| Domain literal type | `string` (not `as const` enum) | Four domains, churn unlikely; the literals are colocated with `MFE_CATALOG` in `investor-web` (single source for B1). Adding a second source here invites drift. The route-provider call site is the only consumer. |
| `MFE_DOMAIN` token | New `InjectionToken<string>` replaces `APPSYNC_CONFIG` | One `<domain>` literal, scoped per route. The token's purpose changes from "config blob" to "domain literal", so renaming clarifies the contract. |
| `jwtTokenProvider` shape | `() => Promise<string>` wrapping `(await fetchAuthSession()).tokens?.idToken?.toString() ?? ''` | Matches today's call site verbatim. Amplify caches/refreshes internally; no extra plumbing needed. |
| `region` source | Read from `AuthConfig` (already DI-provided by A4 as an abstract-class token at `libs/shell/src/auth/auth.config.ts`) inside `GraphqlService`, passed to the factory | `auth.region` is the only region in the runtime payload after §8 collapse. Factory stays pure (takes `region` as a parameter); `GraphqlService` does the DI lookup. **Naming note:** charter §8 calls this `AUTH_CONFIG`; A4 shipped it as `AuthConfig` (abstract class). The spec uses the shipped symbol; the rename is out of scope here. |

---

## 5. Architecture

```
@nestfolio/shell/graphql                        apps/nestfolio-host
┌──────────────────────────────────────┐        ┌────────────────────────────┐
│ MFE_DOMAIN (InjectionToken<string>)  │        │ app.routes.ts:             │
│                                      │        │   { path: 'investor',      │
│ createApolloClient({                 │        │     providers: [           │
│   domain, region, jwtTokenProvider,  │        │       provideMfeGraphql(   │
│   logoutOrchestrator,                │ ◄────  │         'investor')]}      │
│ }) → ApolloClient                    │        │                            │
│                                      │        │ provide-graphql.ts:        │
│ provideMfeGraphql(domain) → Provider │        │   DELETED (helper moved    │
│                                      │        │   to lib)                  │
│ GraphqlService  ─ inject(MFE_DOMAIN, │        │                            │
│   AuthConfig, LogoutOrchestrator)    │        │ app.config.ts:             │
│   builds client via factory          │        │   RuntimeConfig drops      │
│                                      │        │   `appsync:` block;        │
│ CachedQuery (unchanged)              │        │   validateEndpoints checks │
└──────────────────────────────────────┘        │   only copilotApiUrl       │
                                                │                            │
URLs (relative; resolved against           scripts/fetch-runtime-config.sh:
window.location.origin in the browser):    stops querying 4 BFF SSM paths;
  HTTP:  /graphql/<domain>                 emits {auth, copilotApiUrl} only
  WSS:   ${window.location.origin}/realtime/<domain>
        (built absolute so aws-appsync-subscription-link's
         `https→wss` rewrite produces the right URL)
```

Topology realized: four Apollo-client instances (one per `<domain>`), built lazily when each route activates. onboarding-mfe never invokes the factory (no BFF). Pillar 2 + R6 + §5 row 11 satisfied: the singleton is `@nestfolio/shell/graphql`; URLs are relative; an MFE physically cannot reach another BFF.

---

## 6. Detailed design

### 6.1 `libs/shell/src/graphql/create-apollo-client.ts` (new)

```ts
import { ApolloClient, InMemoryCache, HttpLink, ApolloLink } from '@apollo/client/core';
import { onError } from '@apollo/client/link/error';
import { createAuthLink, AUTH_TYPE, AuthOptions } from 'aws-appsync-auth-link';
import { createSubscriptionHandshakeLink } from 'aws-appsync-subscription-link';
import { LogoutOrchestrator } from '../logout-orchestrator';

export interface CreateApolloClientOptions {
  domain: string;
  region: string;
  jwtTokenProvider: () => Promise<string>;
  logoutOrchestrator: LogoutOrchestrator;
}

export function createApolloClient(opts: CreateApolloClientOptions): ApolloClient {
  const { domain, region, jwtTokenProvider, logoutOrchestrator } = opts;

  const httpUri = `/graphql/${domain}`;
  const realtimeUrl = `${window.location.origin}/realtime/${domain}`;

  const auth: AuthOptions = {
    type: AUTH_TYPE.AMAZON_COGNITO_USER_POOLS,
    jwtToken: jwtTokenProvider,
  };

  const errorLink = onError(({ networkError, graphQLErrors }) => {
    const isAuthFailure =
      (networkError && 'statusCode' in networkError &&
        (networkError.statusCode === 401 || networkError.statusCode === 403)) ||
      (graphQLErrors?.some((e) => e.extensions?.['code'] === 'UNAUTHORIZED'));
    if (isAuthFailure) {
      logoutOrchestrator.triggerLogout('apollo-401');
    }
  });

  const httpLink = new HttpLink({ uri: httpUri });
  const authLink = createAuthLink({ url: httpUri, region, auth });
  const subscriptionLink = createSubscriptionHandshakeLink(
    { url: realtimeUrl, region, auth },
    httpLink,
  );

  return new ApolloClient({
    link: ApolloLink.from([errorLink, authLink, subscriptionLink]),
    cache: new InMemoryCache(),
    defaultOptions: {
      query: { fetchPolicy: 'no-cache' },
      mutate: { fetchPolicy: 'no-cache' },
    },
  });
}
```

Notes on the link chain:
- `errorLink` first so it observes responses on the way back. `onError` does not consume errors — they still propagate to the caller's `Observable.error`.
- `authLink` adds `Authorization: <jwtToken>` to outgoing HTTP. For Cognito user-pool auth type, no SigV4 signing happens; the URL passed to `createAuthLink` is not used for signing (only `region` is consulted internally for header naming).
- `subscriptionLink` is a "split" link: subscription operations go via WSS, queries/mutations forward to the next link (`httpLink`).
- `defaultOptions.fetchPolicy === 'no-cache'` matches the existing `GraphqlService` behavior (the `CachedQuery` class handles caching at the service level; Apollo cache is unused).

`window.location.origin` lookup happens in the factory body, so it runs once per client construction (not per request). Tests stub `globalThis.window` (or run in a jsdom env that already provides it).

### 6.2 `libs/shell/src/graphql/error-link-test-helpers.ts` (test-only, new)

Not exported from `index.ts`. Tests import via relative path. Contains fixture builders for `NetworkError`-shaped objects and GraphQL error objects so `error-link.test.ts` doesn't repeat boilerplate.

### 6.3 `libs/shell/src/graphql/mfe-domain.token.ts` (new)

```ts
import { InjectionToken } from '@angular/core';
export const MFE_DOMAIN = new InjectionToken<string>('MFE_DOMAIN');
```

### 6.4 `libs/shell/src/graphql/provide-mfe-graphql.ts` (new)

```ts
import { Provider } from '@angular/core';
import { GraphqlService } from './graphql.service';
import { MFE_DOMAIN } from './mfe-domain.token';

export function provideMfeGraphql(domain: string): Provider[] {
  return [
    { provide: MFE_DOMAIN, useValue: domain },
    { provide: GraphqlService, useClass: GraphqlService },
  ];
}
```

The `useClass: GraphqlService` reprovision is intentional: it forces a per-route instance under the route's hierarchical injector (otherwise a parent-route singleton would be reused across siblings, and the `MFE_DOMAIN` would resolve from the wrong scope).

### 6.5 `libs/shell/src/graphql/graphql.service.ts` (refactored)

```ts
import { Injectable, OnDestroy, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApolloClient, gql } from '@apollo/client/core';
import { fetchAuthSession } from 'aws-amplify/auth';
import { AuthConfig } from '@nestfolio/shell/auth';
import { LogoutOrchestrator } from '../logout-orchestrator';
import { MFE_DOMAIN } from './mfe-domain.token';
import { createApolloClient } from './create-apollo-client';

@Injectable()
export class GraphqlService implements OnDestroy {
  private readonly domain = inject(MFE_DOMAIN);
  private readonly authConfig = inject(AuthConfig);
  private readonly logoutOrchestrator = inject(LogoutOrchestrator);
  private client: ApolloClient;
  private readonly resetFn = () => this.resetClient();

  constructor() {
    this.client = this.build();
    this.logoutOrchestrator.register(this.resetFn);
  }

  ngOnDestroy(): void {
    this.logoutOrchestrator.unregister(this.resetFn);
    this.client.stop();
  }

  // query / mutate / subscribe / resetClient unchanged from current file

  private build(): ApolloClient {
    return createApolloClient({
      domain: this.domain,
      region: this.authConfig.region,
      jwtTokenProvider: async () =>
        (await fetchAuthSession()).tokens?.idToken?.toString() ?? '',
      logoutOrchestrator: this.logoutOrchestrator,
    });
  }
}
```

### 6.6 `libs/shell/src/graphql/index.ts` (modified)

```ts
export { GraphqlService } from './graphql.service';
export { CachedQuery } from './cached-query';
export { MFE_DOMAIN } from './mfe-domain.token';
export { provideMfeGraphql } from './provide-mfe-graphql';
export { createApolloClient } from './create-apollo-client';
export type { CreateApolloClientOptions } from './create-apollo-client';
```

`AppSyncConfig` and `APPSYNC_CONFIG` exports removed.

### 6.7 `apps/nestfolio-host/src/app/app.routes.ts` (modified)

```ts
import { provideMfeGraphql } from '@nestfolio/shell/graphql';
// ...
{ path: 'investor',  providers: [provideMfeGraphql('investor')],  /* ... */ },
{ path: 'dashboard', providers: [provideMfeGraphql('dashboard')], /* ... */ },
{ path: 'advisory',  providers: [provideMfeGraphql('advisory')],  /* ... */ },
{ path: 'ledger',    providers: [provideMfeGraphql('ledger')],    /* ... */ },
```

Onboarding route gets no `provideMfeGraphql` call (unchanged from today).

### 6.8 `apps/nestfolio-host/src/app/app.config.ts` (modified)

```ts
export interface RuntimeConfig {
  auth: { userPoolId: string; clientId: string; region: string };
  copilotApiUrl: string;
}

export function validateEndpoints(config: RuntimeConfig): void {
  const url = config.copilotApiUrl;
  if (!url) return;
  if (url.startsWith('https://')) return;
  if (isDevMode() && url.startsWith('http://localhost')) return;
  throw new Error(`Invalid endpoint URL: "${url}". All endpoints must use HTTPS.`);
}
```

`appsync` field removed from the type and from every fixture/spec that mentions it.

### 6.9 `apps/nestfolio-host/src/app/runtime-config.service.ts` (modified)

`appsync` getter deleted. The `auth` and `copilotApiUrl` getters stay.

### 6.10 `scripts/fetch-runtime-config.sh` (modified)

Lines 94-97 (the four `*-bff/api/graphqlUrl` SSM lookups) and lines 110-115 (the `appsync` JSON block) deleted. Output reduces to:

```json
{
  "auth": {
    "userPoolId": "...",
    "clientId": "...",
    "region": "..."
  },
  "copilotApiUrl": "https://.../api/copilotkit"
}
```

### 6.11 Files deleted

- `libs/shell/src/graphql/appsync.config.ts` and `libs/shell/test/graphql/appsync-config.test.ts`.
- `apps/nestfolio-host/src/app/provide-graphql.ts` and `apps/nestfolio-host/test/app/provide-graphql.spec.ts`.

### 6.12 Files unchanged

- All eight MFE service consumers (`dashboard.service.ts`, `deposit.service.ts`, `notification.service.ts`, `advisory.service.ts`, `comparison.service.ts`, `time-travel.service.ts`) inject `GraphqlService`. Behavior identical.
- All eight MFE service tests use `provide({ provide: GraphqlService, useValue: mock })`. No change.
- `libs/shell/src/graphql/cached-query.ts` and its test.
- `libs/shell/src/logout-orchestrator.ts` and its test.

---

## 7. Data flow

**Per-route lifecycle.** Angular's hierarchical injector instantiates `GraphqlService` lazily the first time an MFE service injects it under that route's providers. Constructor calls `createApolloClient(...)`. `MFE_DOMAIN` resolves to the route's literal; `AuthConfig` is the singleton already provisioned by `app.config.ts`. On route teardown (lazy module destroyed), `ngOnDestroy` calls `client.stop()` and unregisters from `LogoutOrchestrator`. Logout: `LogoutOrchestrator.triggerLogout()` already iterates registered reset functions → existing `resetClient()` rebuilds the inner client (existing pattern, kept).

**Subscription path.** MFE service calls `graphql.subscribe(query, vars)` → `apollo.subscribe(...)` → `subscriptionLink` opens `wss://${host}/realtime/${domain}?header=${base64(jwtAuthHeader)}&payload=e30=`. CloudFront's `/realtime/<domain>` behavior + viewer-request CF Function rewrites path to `/graphql` and forwards to the AppSync realtime origin (B1-shipped). The lib speaks AppSync's WSS subprotocol unchanged.

**Auth refresh.** `jwtTokenProvider = async () => (await fetchAuthSession()).tokens?.idToken?.toString() ?? ''`. Amplify caches and refreshes the session internally (5-min TTL by default). authLink calls this on every operation and on every WSS handshake.

---

## 8. Error handling

| Error | Surface | Behavior |
|---|---|---|
| `networkError.statusCode === 401\|403` (HTTP) | errorLink | calls `logoutOrchestrator.triggerLogout('apollo-401')`; error still propagates to caller |
| `graphQLErrors[].extensions.code === 'UNAUTHORIZED'` | errorLink | same as above |
| Other graphQLErrors / 5xx | errorLink | passthrough (caller decides) |
| WSS handshake failure | subscription Observable's error channel | unchanged — `NotificationService` + `AdvisoryService` keep exponential-backoff reconnect (5 s × 2^n, max 5 attempts) |
| WSS `Connection error: Unauthorized` mid-stream | subscription error channel + indirectly errorLink on next op | reconnect attempts tried first; eventual 401 on next HTTP op triggers logout |

`triggerLogout` is idempotent and self-deduping (existing behavior of `LogoutOrchestrator`); concurrent 401s from multiple in-flight operations don't cascade.

---

## 9. Testing

**New unit tests in `libs/shell/test/graphql/`**

- `create-apollo-client.test.ts` — asserts (a) `httpLink.uri === '/graphql/${domain}'` for each domain literal, (b) subscription link constructed with `${origin}/realtime/${domain}`, (c) link order `[errorLink, authLink, subscriptionLink]`, (d) `defaultOptions.query.fetchPolicy === 'no-cache'`, (e) `cache instanceof InMemoryCache`. Mocks `aws-appsync-{auth,subscription}-link` factories to capture args.
- `error-link.test.ts` — feeds `errorLink` fixtures: 401, 403, `'UNAUTHORIZED'`, 500, plain GraphQL error. Asserts `logoutOrchestrator.triggerLogout` called only on the auth-error fixtures, with reason string `'apollo-401'`.
- `provide-mfe-graphql.test.ts` — TestBed asserts `provideMfeGraphql('investor')` provides `MFE_DOMAIN === 'investor'` and `inject(GraphqlService) instanceof GraphqlService`.

**Existing tests to update**

- `libs/shell/test/graphql/graphql.service.test.ts` — swap `APPSYNC_CONFIG` provider for `MFE_DOMAIN` + `AuthConfig`; behavior assertions unchanged.
- `libs/shell/test/graphql/appsync-config.test.ts` — delete (token gone).
- `apps/nestfolio-host/test/app/provide-graphql.spec.ts` — delete.
- `apps/nestfolio-host/test/app/runtime-config.service.spec.ts` + `app.config.spec.ts` — drop `appsync.*` from fixtures + assertions.
- `scripts/fetch-runtime-config.test.mjs` — drop the four BFF SSM mocks; new shape asserts `output.appsync === undefined`.

**Eight MFE service tests unchanged** — they mock `GraphqlService`, not its inner client. Verified file list: `dashboard.service.spec.ts`, `deposit.service.spec.ts`, `notification.service.spec.ts`, `advisory.service.spec.ts`, `comparison.service.spec.ts`, `time-travel.service.spec.ts`.

---

## 10. Migration mechanics

Branch: `feat/b3-apollo-per-mfe-clients`, cut from `main` after `feat/b2-federation-mechanical-fixes` merges.

**Order** (TDD per task; each step a separate commit):

1. **Lib factory** — `create-apollo-client.ts` + `error-link` (inline) + `MFE_DOMAIN` token; new tests.
2. **`GraphqlService` refactor** — switch from `APPSYNC_CONFIG` to `MFE_DOMAIN` + `AuthConfig`; update existing test.
3. **`provideMfeGraphql`** — new exported helper + test.
4. **Host wiring** — `app.routes.ts` imports `provideMfeGraphql` from `@nestfolio/shell/graphql`; delete `apps/nestfolio-host/src/app/provide-graphql.ts` + its spec.
5. **Runtime-config simplification** — drop `appsync` from `RuntimeConfig` type, `validateEndpoints`, `RuntimeConfigService`; update host specs.
6. **Producer** — `scripts/fetch-runtime-config.sh` drops four SSM lookups + `appsync` JSON block; update producer test.
7. **Cleanup** — delete `appsync.config.ts` + its test + `index.ts` re-exports.

**Verification gates** (must pass before PR):

- `pnpm nx run-many --target=test -p shell,nestfolio-host,investor-mfe,advisory-mfe,dashboard-mfe,ledger-mfe`
- `pnpm nx run-many --target=lint -p shell,nestfolio-host,investor-mfe,advisory-mfe,dashboard-mfe,ledger-mfe`
- `pnpm nx run nestfolio-host:build` (re-runs B2's `assert-shell-html.mjs` automatically via the chained `build` target)
- Manual browser smoke: `pnpm nx run nestfolio-host:config --prefix=dev` → `pnpm nx serve nestfolio-host` → load `/dashboard`, `/investor`, `/advisory`, `/ledger`. Network panel must show `POST /graphql/<domain>` and `WS /realtime/<domain>` (the latter on `/investor` after triggering a deposit, on `/advisory` on a decision detail page). No request URL contains `*.amazonaws.com`.

---

## 11. What this obsoletes

- The `APPSYNC_CONFIG` injection token and `AppSyncConfig` interface.
- The host-local `provideGraphqlFor(bffName)` helper (replaced by `@nestfolio/shell/graphql`'s `provideMfeGraphql(domain)`).
- The `appsync` block in `RuntimeConfig` and the four `*-bff/api/graphqlUrl` SSM lookups in `fetch-runtime-config.sh`.

---

## 12. References

- `docs/superpowers/specs/2026-04-24-mfe-architecture-charter.md` — §5 row 11, §7 R6, §8, Pillar 2, §9 V1.
- `docs/superpowers/plans/2026-04-24-mfe-charter-migration-roadmap.md` — §B3.
- `docs/superpowers/plans/2026-04-24-wss-cloudfront-spike.md` — V1 PASS evidence; pinned subscription-transport choice.
- `libs/shell/src/graphql/graphql.service.ts` — current factory inlined; this design extracts it.
- `apps/nestfolio-host/src/app/provide-graphql.ts` — current host-local DI helper; this design moves and renames it.
- `apps/nestfolio-host/src/app/app.config.ts` — current `RuntimeConfig` shape; this design collapses to charter §8.
- `scripts/fetch-runtime-config.sh` — current producer; this design removes four SSM lookups.
- `libs/frontend-deps/index.js` — confirms `aws-appsync-{auth,subscription}-link` and `@apollo/client` are federation singletons; B3 adds no new singletons.
