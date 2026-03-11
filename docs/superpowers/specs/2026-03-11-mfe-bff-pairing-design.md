# MFE–BFF Pairing & GraphQL Multi-Endpoint Design

**Date:** 2026-03-11
**Status:** Approved

## Problem

The frontend has a single `GraphqlService` singleton (`providedIn: 'root'`) configured with one AppSync endpoint (`investorBff`). All 4 MFEs share this instance, routing every query/mutation/subscription to the same backend. This violates the one-MFE → one-BFF architectural rule and prevents independent team ownership of BFF/MFE pairs.

Additionally, `dashboard-mfe` directly queries `order-ledger` for time-travel and simulation comparison — features that belong to order-ledger's domain and shouldn't be forced into dashboard-bff as dumb projections (they require replay logic and full ledger state).

## Design Decisions

1. **Each MFE talks exclusively to its paired BFF** — no cross-BFF queries from any MFE.
2. **Route-scoped `GraphqlService` instances** — the shell provides per-route `GraphqlService` via Angular DI; MFEs just `inject(GraphqlService)` with no awareness of endpoint routing.
3. **Split dashboard-mfe** — time-travel, simulation comparison, and order history move to a new `ledger-mfe` paired with `order-ledger-bff`.
4. **Keep identity-mfe and notification-mfe separate** — different lifecycles (transient onboarding vs persistent inbox), cross-domain nature of notifications, zero code overlap.
5. **Replace Amplify API with Apollo Client** — Amplify v6's `generateClient()` is bound to a single global endpoint with no multi-API support. Apollo Client natively supports multiple instances with per-endpoint configuration.
6. **Use AppSync-specific Apollo links** — `aws-appsync-auth-link` and `aws-appsync-subscription-link` handle Cognito auth and AppSync's custom WebSocket subscription protocol.
7. **Rename `order-ledger` → `order-ledger-bff`** — it now serves a frontend MFE, so it follows the role-postfix naming convention.

## Final MFE → BFF Mapping

| Route | MFE | BFF | Team |
|-------|-----|-----|------|
| `/identity` | identity-mfe | investorBff | Investor |
| `/notifications` | notification-mfe | investorBff | Investor |
| `/dashboard` | dashboard-mfe | dashboardBff | Dashboard |
| `/advisory/:id` | advisory-mfe | advisoryBff | Advisory |
| `/ledger` | ledger-mfe (new) | orderLedgerBff | Execution |

Each BFF has its own AppSync API, schema.graphql, resolver Lambda, and DynamoDB table. Each team owns both sides of the contract.

### portfolioBff Disposition

`portfolioBff` exists in `RuntimeConfig` and has a backend service (`services/execution/portfolio-bff/`) but no MFE currently consumes it directly. No frontend service imports `portfolio-bff.queries.ts`. Its data (portfolio positions, cash balance, performance) reaches the frontend through dashboard-bff projections. In this design:

- `portfolioBff` **remains as a backend-only service** — no MFE is assigned to it.
- Its endpoint stays in `RuntimeConfig` for potential future use but is not wired to any `provideGraphqlFor` route.
- If a dedicated portfolio MFE is needed in the future, it will pair 1:1 with `portfolioBff`.

## Architecture

### GraphqlService Multi-Instance (Apollo Client)

**Current state:** Single `GraphqlService` singleton using Amplify's `generateClient()`, configured with one global endpoint.

**New state:** `GraphqlService` wraps a per-instance `ApolloClient` configured with the BFF's endpoint.

#### Injection Token

```typescript
export const APPSYNC_CONFIG = new InjectionToken<AppSyncConfig>('APPSYNC_CONFIG');

export interface AppSyncConfig {
  endpoint: string;
  region: string;
}
```

#### GraphqlService (rewritten internals)

- `@Injectable()` decorator (no `providedIn`) — provided per route scope
- Constructor uses `inject(APPSYNC_CONFIG)` to receive endpoint config
- Creates its own `ApolloClient` with:
  - `createAuthLink({ url, region, auth })` from `aws-appsync-auth-link` — Cognito JWT via `fetchAuthSession()`
  - `createSubscriptionHandshakeLink({ url, region, auth }, httpLink)` from `aws-appsync-subscription-link` — AppSync real-time WebSocket protocol
  - `InMemoryCache` (per-instance, no shared cache between BFFs)
- Public API unchanged: `query<T>()`, `mutate<T>()`, `subscribe<T>()`, `resetClient()`
- Implements `OnDestroy`: calls `client.stop()` to close active subscriptions and WebSocket connections when the route-scoped injector is destroyed (e.g., navigating away from the MFE route)
- Auth configuration:
  ```typescript
  auth = {
    type: AUTH_TYPE.AMAZON_COGNITO_USER_POOLS,
    jwtToken: async () => {
      const session = await fetchAuthSession();
      return session.tokens?.idToken?.toString() ?? '';
    }
  }
  ```

#### provideGraphqlFor Factory

```typescript
export function provideGraphqlFor(bffName: keyof RuntimeConfig['appsync']): Provider[] {
  return [
    { provide: APPSYNC_CONFIG, useFactory: () => getRuntimeConfig().appsync[bffName] },
    { provide: GraphqlService, useClass: GraphqlService },
  ];
}
```

Angular creates a new `GraphqlService` instance per route scope because the provider is declared at the route level. The `APPSYNC_CONFIG` token is also route-scoped, so each instance gets the correct endpoint. Services inside the MFE that call `inject(GraphqlService)` resolve to this route-scoped instance.

#### Shell Route Configuration

```typescript
// app.routes.ts
{
  path: 'dashboard',
  providers: [provideGraphqlFor('dashboardBff')],
  loadChildren: () => loadRemoteModule('dashboard-mfe', './routes'),
  canActivate: [authGuard],
},
{
  path: 'advisory/:id',
  providers: [provideGraphqlFor('advisoryBff')],
  loadChildren: () => loadRemoteModule('advisory-mfe', './routes'),
  canActivate: [authGuard],
},
{
  path: 'notifications',
  providers: [provideGraphqlFor('investorBff')],
  loadChildren: () => loadRemoteModule('notification-mfe', './routes'),
  canActivate: [authGuard],
},
{
  path: 'identity',
  providers: [provideGraphqlFor('investorBff')],
  loadChildren: () => loadRemoteModule('identity-mfe', './routes'),
  canActivate: [authGuard],
},
{
  path: 'ledger',
  providers: [provideGraphqlFor('orderLedgerBff')],
  loadChildren: () => loadRemoteModule('ledger-mfe', './routes'),
  canActivate: [authGuard],
},
```

MFE services continue to `inject(GraphqlService)` unchanged — they get the route-scoped instance automatically.

### provideAppSync Removal

`provideAppSync()` in `appsync.provider.ts` is deleted. Amplify is configured for Auth only (Cognito) in the shell. No Amplify API configuration needed.

### Legacy appsync-client.ts Removal

The file `libs/appsync-client/src/appsync-client.ts` contains bare `query()`, `mutate()`, `subscribe()`, `resetClient()` functions that use `generateClient()` from `aws-amplify/api`. This file is **deleted entirely**. The `GraphQLResult<T>` type it exports is moved to `graphql.service.ts` (or inlined, since Apollo provides its own result types). The re-export in `index.ts` is removed.

## New MFE: ledger-mfe

### Purpose

Exposes order-ledger-bff's domain features: time-travel (portfolio state at a point in time), simulation comparison (actual vs AI-advised), and order history.

### Routes

| Path | Component | Description |
|------|-----------|-------------|
| `/ledger` | TimeTravelContainerComponent | Portfolio at a point in time |
| `/ledger/simulation` | ComparisonContainerComponent | Actual vs simulated portfolio comparison |
| `/ledger/orders` | OrderHistoryComponent | Paginated ledger entries (out of scope — `GET_ORDER_HISTORY` query string not yet in appsync-client; route placeholder only, component stubbed) |

### Files Moved from dashboard-mfe

| From (dashboard-mfe) | To (ledger-mfe) |
|----------------------|-----------------|
| `services/time-travel.service.ts` | `services/time-travel.service.ts` |
| `services/comparison.service.ts` | `services/comparison.service.ts` |
| `stores/time-travel.store.ts` | `stores/time-travel.store.ts` |
| `time-travel/time-travel-container.component.ts` | `time-travel/time-travel-container.component.ts` |
| `time-travel/time-travel-portfolio.component.ts` | `time-travel/time-travel-portfolio.component.ts` |
| `time-travel/timeline-slider.component.ts` | `time-travel/timeline-slider.component.ts` |
| `comparison/comparison-container.component.ts` | `comparison/comparison-container.component.ts` |
| `comparison/comparison-detail.component.ts` | `comparison/comparison-detail.component.ts` |
| `comparison/comparison-divergence-table.component.ts` | `comparison/comparison-divergence-table.component.ts` |

### Native Federation Configuration

Same pattern as other MFEs: `bootstrap.ts` + `main.ts` + `federation.config.js` exposing `./routes`.

### Federation Manifest Update

Add `ledger-mfe` to `apps/nestfolio-host/public/assets/federation.manifest.json`:
```json
{
  "dashboard-mfe": "http://localhost:4201/remoteEntry.json",
  "advisory-mfe": "http://localhost:4202/remoteEntry.json",
  "notification-mfe": "http://localhost:4203/remoteEntry.json",
  "identity-mfe": "http://localhost:4204/remoteEntry.json",
  "ledger-mfe": "http://localhost:4205/remoteEntry.json"
}
```

## Rename: order-ledger → order-ledger-bff

### Files Affected

- Directory: `services/execution/order-ledger/` → `services/execution/order-ledger-bff/`
- `project.json`: update name
- `main.ts`, `service.stack.ts`, `jest.config.js`: update internal references
- `libs/cdk-constructs/src/runtime-config.ts`: update SSM parameter name
- `libs/appsync-client/src/graphql/order-ledger.queries.ts` → `order-ledger-bff.queries.ts`
- `libs/appsync-client/src/index.ts`: update re-export
- `apps/nestfolio-host/src/environments/environment.ts` + `environment.prod.ts`: `orderLedger` → `orderLedgerBff`
- `apps/nestfolio-host/src/app/app.config.ts`: `RuntimeConfig` key rename
- `apps/nestfolio-host/public/assets/config.json`: add missing `dashboardBff` and `orderLedgerBff` keys (currently only has `investorBff`, `portfolioBff`, `advisoryBff`)
- Execution-hub stack: update import path

## Dashboard-MFE Cleanup

### Removed

- `services/time-travel.service.ts` — moved to ledger-mfe
- `services/comparison.service.ts` — moved to ledger-mfe
- `stores/time-travel.store.ts` — moved to ledger-mfe
- `time-travel/` directory (3 components) — moved to ledger-mfe
- `comparison/` directory (3 components) — moved to ledger-mfe
- All `order-ledger.queries.ts` / `order-ledger-bff.queries.ts` imports

### Kept

- `services/dashboard.service.ts` — queries dashboardBff only (GET_DASHBOARD, GET_POSITION_SNAPSHOTS, GET_RECENT_ACTIVITY, GET_SIMULATION_SUMMARY)
- `stores/dashboard.store.ts`
- `dashboard/` directory (KPIs, positions, activity, advisory alerts, allocation, comparison card)
- `comparison-card.component.ts` — teaser widget fed by dashboardBff's SimulationSummary projection

### Modified

- `comparison-card.component.ts`: routerLink changed from `['comparison']` → `['/ledger/simulation']` (absolute path, crosses MFE boundary — verify this resolves correctly in the federated shell router)
- `app.routes.ts`: remove `/time-travel` and `/comparison` routes

## Dependencies

### Added

| Package | Version | Purpose |
|---------|---------|---------|
| `@apollo/client` | `4.x` | GraphQL client (multi-instance capable) |
| `aws-appsync-auth-link` | `4.0.1` | Cognito JWT auth for AppSync HTTP requests |
| `aws-appsync-subscription-link` | `4.0.1` | AppSync real-time WebSocket subscription protocol |

### Removed (usage only)

| Package | Action |
|---------|--------|
| `aws-amplify/api` | Remove all imports. Keep `aws-amplify/auth` for Cognito. |
| `generateClient` from `aws-amplify/api` | Replaced by per-instance `ApolloClient` |

## Compatibility Matrix

| Package | Peer Dependency | Project Version |
|---------|----------------|-----------------|
| `aws-appsync-auth-link@4.0.1` | `@apollo/client 4.x` | `4.x` |
| `aws-appsync-subscription-link@4.0.1` | `@apollo/client 4.x`, `rxjs ^7` | `4.x`, `^7` |

All peer dependencies align. `apollo-angular` is **not used** — `GraphqlService` wraps `ApolloClient` directly without the `apollo-angular` Angular integration layer, keeping the abstraction thin and under our control. The AppSync link packages are in maintenance mode (security/compat fixes only) but functional and compatible.

## Testing Strategy

- **GraphqlService unit tests**: mock `ApolloClient`, verify query/mutate/subscribe delegate correctly
- **provideGraphqlFor tests**: verify correct `APPSYNC_CONFIG` injection per BFF name
- **MFE service tests**: unchanged — they already mock `GraphqlService`
- **ledger-mfe component tests**: moved from dashboard-mfe, updated imports
- **Integration**: verify each MFE route gets the correct endpoint via route-scoped providers
- **Shell route tests**: verify `providers` array on each route

## Lifecycle & Cleanup Notes

### Route-Scoped GraphqlService Lifecycle

When a user navigates away from an MFE route, Angular destroys the route-scoped injector. `GraphqlService` implements `OnDestroy` and calls `client.stop()` to clean up Apollo Client's active subscriptions and WebSocket connections. When the user navigates back, a fresh `GraphqlService` + `ApolloClient` + `InMemoryCache` is created.

### CachedQuery Interaction

MFE services (e.g., `DashboardService`) create `CachedQuery` instances that reference `this.graphql`. Since Angular's lazy-loaded route injector persists for the lifetime of the route (not destroyed on child navigation), the `GraphqlService` instance is stable while the MFE is active. `CachedQuery` references remain valid. When the route is destroyed, both the service and its caches are destroyed together.

### LogoutOrchestrator Cleanup

Each route-scoped `GraphqlService` registers with `LogoutOrchestrator` in its constructor. `LogoutOrchestrator.register()` accumulates callbacks. On logout, all registered callbacks fire (resetting all active Apollo clients). On `OnDestroy`, `GraphqlService` should deregister its callback to avoid calling `resetClient()` on a destroyed instance. Add a `deregister` return value to `LogoutOrchestrator.register()` if not already present.

### MFE Service providedIn

Services moved to `ledger-mfe` (`TimeTravelService`, `ComparisonService`) and `TimeTravelStore` use `providedIn: 'root'`. In a lazy-loaded federated MFE, `providedIn: 'root'` resolves to the host's root injector. Since these services are only imported within the ledger-mfe chunk, Angular's tree-shaking ensures they only exist when ledger-mfe is loaded. However, for clarity and to prevent accidental injection from other MFEs, change them to `providedIn: 'any'` or remove `providedIn` and provide them explicitly in the ledger-mfe route providers.

## Non-Goals

- Apollo normalized cache sharing between BFFs (each instance has its own `InMemoryCache`)
- Replacing `CachedQuery` utility with Apollo cache policies (keep changes bounded)
- Offline support (not available with standalone AppSync links)
- Merging identity-mfe + notification-mfe (different lifecycles, cross-domain nature of notifications, zero code overlap)
