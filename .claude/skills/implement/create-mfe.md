---
name: create-mfe
description: Scaffold MFE features — routing, BFF integration, shared UI. Use when adding frontend features to any micro-frontend.
---

## When This Skill Applies
- Adding a new route/feature to an existing MFE (`investor-mfe`, `dashboard-mfe`, `advisory-mfe`, `ledger-mfe`, `onboarding-mfe`)
- Creating a new standalone micro-frontend
- Wiring a new BFF GraphQL operation into the frontend

## Architecture Overview

MFEs live in `apps/<name>-mfe/`. The host shell (`apps/nestfolio-host/`) loads them via
`@angular-architects/native-federation` (`loadRemoteModule`). Each MFE exposes a single
`./routes` entrypoint from `src/app/remote-routes.ts`.

The host registers each MFE as a named remote in `apps/nestfolio-host/src/app/app.routes.ts`:
- Route receives `providers: [provideGraphqlFor('<bffName>')]` — scopes the AppSync client to the correct BFF
- Guards applied at host level: `authGuard`, `onboardingCompletedGuard` (or `onboardingPendingGuard`)
- MFE fallback: `MfeErrorComponent` if remote fails to load

GraphQL is NOT injected globally — it is scoped per route via `provideGraphqlFor()` in the
host routes file and re-provided in `remote-routes.ts`'s root `providers` array.

## MFE Internal Structure Convention

```
apps/<name>-mfe/src/app/
  remote-routes.ts          ← Federation entry: exposes Routes, provides Service + Store
  graphql/<name>-bff.queries.ts  ← All GQL strings (queries, mutations, subscriptions)
  <feature>/
    <feature>.component.ts  ← Standalone component, loadComponent()-lazy in remote-routes
    <feature>.component.ts  ← Sub-components as needed
  services/
    <feature>.service.ts    ← @Injectable(), inject(GraphqlService), no providedIn
  stores/
    <feature>.store.ts      ← signalStore with withCallState(), withLogoutReset()
```

Key conventions:
- All components are **standalone** (`standalone: true`)
- Services and stores have **no `providedIn`** — provided explicitly in `remote-routes.ts` providers
- State management: **@ngrx/signals** `signalStore` with shell features (`withCallState`, `withDevtools`, `withLogoutReset`)
- UI library: **PrimeNG** components (`primeng/button`, `primeng/card`, etc.)
- Translations: `I18nService` from `@nestfolio/shell/i18n` — use `i18n.t('key')` in templates
- Data attributes: `data-testid="..."` on interactive elements for tests

## Prerequisites
- Read the target MFE's existing `remote-routes.ts` and `src/app/` structure
- Read the relevant BFF's `CLAUDE.md` card for available GraphQL operations

## Checklist

- [ ] 1. **Identify target MFE and BFF**
  - MFE → BFF mapping: `investor-mfe` → `investor-bff`, `dashboard-mfe` → `dashboard-bff`,
    `advisory-mfe` → `advisory-bff`, `ledger-mfe` → `ledger-bff`,
    `onboarding-mfe` → `onboarding-bff`
  - Read BFF's `CLAUDE.md` for available queries/mutations/subscriptions

- [ ] 2. **Add GraphQL strings to `graphql/<name>-bff.queries.ts`**
  - Use template literal strings (no `gql` tag) — plain strings work with `GraphqlService`
  - Group by: fragments, queries, mutations, subscriptions
  - Call via `graphql.query<T>()`, `.mutate<T>()`, `.subscribe<T>()`

- [ ] 3. **Create service in `services/<feature>.service.ts`**
  - `@Injectable()` (no `providedIn`)
  - `private readonly graphql = inject(GraphqlService)` from `@nestfolio/shell/graphql`
  - Add to `remote-routes.ts` root `providers` array

- [ ] 4. **Create store in `stores/<feature>.store.ts`**
  - `signalStore(withState(...), withCallState(), withComputed(...), withMethods(...))`
  - Import helpers from `@nestfolio/shell`: `withCallState`, `withDevtools`, `withLogoutReset`
  - Use `setLoading`/`setError` call-state helpers in async methods
  - Add to `remote-routes.ts` root `providers` array

- [ ] 5. **Create standalone component(s) in `<feature>/<feature>.component.ts`**
  - `standalone: true`, imports: PrimeNG modules + `CommonModule` + `@nestfolio/ui` components
  - Inject store and/or service via `inject()`
  - Use `@if` / `@for` control flow (not `*ngIf` / `*ngFor`)
  - Add `data-testid` on interactive elements
  - Use `I18nService` for all user-visible strings

- [ ] 6. **Register route in `remote-routes.ts`**
  ```ts
  {
    path: '<feature-path>',
    loadComponent: () => import('./<feature>/<feature>.component').then(m => m.FeatureComponent),
  }
  ```
  Service and Store are provided at the root path level, not per child route.

- [ ] 7. **Register MFE route in host (new MFE only)**
  - Add to `apps/nestfolio-host/src/app/app.routes.ts` with `provideGraphqlFor('<bffName>')`
  - Add `name` and `exposes` entry to `apps/<name>-mfe/federation.config.js`
  - Add shared singleton deps to `federation.config.js` matching the existing pattern

- [ ] 8. **Add i18n keys** to `libs/shell/src/i18n/assets/en-GB.json` and `it-IT.json`

- [ ] 9. **Write tests** in `test/app/<feature>/` (NOT in `src/`)
  - `pnpm nx test <mfe-name>` to run

- [ ] 10. **Commit**

## Reference Files
- Host routes: `apps/nestfolio-host/src/app/app.routes.ts`
- Host GraphQL provider: `apps/nestfolio-host/src/app/provide-graphql.ts`
- Example MFE (most complete): `apps/investor-mfe/src/app/`
- Federation config pattern: `apps/investor-mfe/federation.config.js`
- GraphqlService: `libs/shell/src/graphql/graphql.service.ts`
- AppSync config: `libs/shell/src/graphql/appsync.config.ts`
- Auth guards: `libs/shell/src/auth/auth.guard.ts`, `onboarding.guard.ts`
- Shared stores: `libs/shell/src/stores/` (auth, tenant, notification, ui)
- Shell features: `libs/shell/src/features/` (withCallState, withDevtools, withLogoutReset)
- UI components: `libs/ui/src/` — layout (ShellLayout, Header, Sidebar, BottomNav), shared (AgentBadge, StatusBadge, EmptyState, Expandable, LoadingSkeleton), pipes (CurrencyFormat, PercentFormat, RelativeTime)
- Theme tokens: `libs/ui/src/theme/tokens.scss`
- BFF services: `services/investor/*-bff/`, `services/advisory/advisory-bff/`, `services/ledger/ledger-bff/`

## Key Types and APIs

```ts
// GraphqlService (from @nestfolio/shell/graphql)
graphql.query<T>(queryString, variables?)     → Promise<T>
graphql.mutate<T>(mutationString, variables?) → Promise<T>
graphql.subscribe<T>(subscriptionString)      → Observable<T>

// signalStore store pattern
export const FeatureStore = signalStore(
  withState<FeatureState>(initialState),
  withCallState(),       // adds loading(), error() signals + setLoading/setError helpers
  withDevtools('FeatureStore'),
  withLogoutReset(initialState),
  withComputed((store) => ({ ... })),
  withMethods((store) => ({ ... })),
);
```

## Anti-Patterns
- NEVER call BFF APIs directly — always through `GraphqlService` (which wraps AppSync)
- NEVER use `providedIn: 'root'` on MFE-local services or stores — scope them in `remote-routes.ts`
- NEVER use `*ngIf` / `*ngFor` — use `@if` / `@for` control flow
- NEVER duplicate UI components — check `libs/ui/src/` first
- NEVER add new singleton deps to `federation.config.js` without checking existing shared list — version conflicts break federation at runtime
- NEVER hardcode user-visible strings — always use `I18nService` and add keys to both locale files
- NEVER put tests in `src/` — tests live in `test/`
