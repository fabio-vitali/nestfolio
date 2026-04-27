# Plan G — Lazy-after-auth FeatureFlagService

**Date:** 2026-04-27
**Status:** Design (approved)
**Branch target:** `feat/g-feature-flags-lazy-after-auth` (cut from `main`)
**Predecessor:** Plan F — `2026-04-27-f-loadmfe-routes-shape-design.md`
**Charter row:** §4 row 11 (feature flags as shell-wired cross-cutting concern)

---

## 1. Problem

`FeatureFlagService` (`libs/shell/src/feature-flags/feature-flag.service.ts`)
is instantiated by an `APP_INITIALIZER` registered in `provideFeatureFlags()`.
Its constructor immediately calls:

- `loadInitialFlags()` → `client.query({ query: GET_FEATURE_FLAGS })`
- `subscribeToUpdates()` → `client.subscribe({ query: ON_FEATURE_FLAG_UPDATE })`

The dedicated Apollo client targets `/graphql/investor`, an authenticated
AppSync endpoint guarded by Cognito.

When cf-smoke runs unauthenticated (or any anonymous landing — `/login`,
`/signup`, `/confirm`), there is no Cognito JWT, so AppSync returns HTTP 401
on the bootstrap query. The service catches the error and logs to
`console.error`. Bootstrap proceeds. cf-smoke's strict zero-console-error
policy fails.

This is a **structural mismatch**: an authenticated query is being fired at
bootstrap, before any user signs in. The mismatch was masked pre-Plan-E2 by
upstream bootstrap crashes; Plan E2 unmasked it.

## 2. Architectural decision

**Lazy-after-auth.** `FeatureFlagService` waits for `AuthStore.status` to
transition into `'authenticated'` before issuing its first query. On
`'unknown'` and `'unauthenticated'`, the service stays inert. On logout, it
tears down the subscription and clears `FeatureFlagsStore`. On re-login, it
reloads.

Rationale (rejected alternatives):

- **Public/anonymous resolver.** Would require flipping `getFeatureFlags`'s
  AppSync auth rule on `investor-bff`, expand the public surface, and require
  a CDK + resolver change. Feature flags would become readable by anyone
  hitting the CF URL. Larger blast radius, weaker security posture.
- **AuthState-known gate.** Keep APP_INITIALIZER, await `'authenticated' OR
  'unauthenticated'`, skip the query for unauthenticated users. Adds
  bootstrap latency for the case where the answer is "skip" anyway.
- **Skip + retry post-login.** Catch 401 silently; re-trigger after login.
  Couples cf-smoke's success criteria to a silent-skip detail; risks
  divergent state between "no flags loaded" and "flags failed to load".

## 3. Architecture

### 3.1 Effect-driven lifecycle

`FeatureFlagService` constructor sets up an Angular `effect()` that watches
`AuthStore.status` and `AuthStore.user()`. State machine:

| `AuthStore.status` | Action                                                      |
| ------------------ | ----------------------------------------------------------- |
| `'unknown'`        | No-op. Effect re-fires when status resolves.                 |
| `'unauthenticated'` | No-op. Subscription stays torn down. Store stays empty.     |
| `'authenticated'`  | Load flags + start subscription **once per session**.        |

The "once per session" guard is a private boolean (`#loaded`) reset by the
logout reset fn. Without it, any sub-state change inside `'authenticated'`
(e.g. `updateUser`) would re-fire the load.

### 3.2 Logout integration

The constructor registers a reset fn with `LogoutOrchestrator`:

```ts
this.logoutOrchestrator.register(this.resetFn);
```

`resetFn` does three things:

1. Unsubscribe the live GraphQL subscription if active.
2. Reset the `FeatureFlagsStore` to its empty initial state.
3. Clear the `#loaded` flag so the next `'authenticated'` transition reloads.

`AuthStore.logout()` already calls `LogoutOrchestrator.resetAll()` (see
`libs/shell/src/stores/auth.store.ts:48-51`), so wiring is automatic.

### 3.3 `provideFeatureFlags()` shape

Keep a single `APP_INITIALIZER` whose only job is to **instantiate** the
service so its constructor effect registers. The initializer returns a
resolved Promise immediately — no network. This pattern is preferred over
`ENVIRONMENT_INITIALIZER` because:

- It composes with the `'down to deps in registration order'` semantics
  Angular guarantees for `APP_INITIALIZER`.
- The codebase already uses `APP_INITIALIZER`-as-instantiator elsewhere
  (e.g. `initializeAuth` in `app.config.ts:73-89`), so it matches existing
  shape.

```ts
{
  provide: APP_INITIALIZER,
  useFactory: () => {
    inject(FeatureFlagService); // constructor effect registers; no I/O
    return () => Promise.resolve();
  },
  multi: true,
}
```

### 3.4 No changes to consumers

`FeatureFlagsStore.isEnabled(name)` already returns `true` for unknown
flags (`libs/ui/feature-flags/src/lib/feature-flags.store.ts:27-29`), so
the empty-flag state during anonymous routes is safe by construction. UI
components that consume flags do not need updating.

## 4. Rejected micro-decisions

- **`Effect` vs `toObservable + subscribe`.** `effect()` is the Angular
  signals primitive that matches the codebase's style (used throughout
  `libs/shell/src/`). Using `toObservable()` adds an RxJS layer for no
  benefit.
- **Service-owned vs provider-owned effect.** Owning the effect inside the
  service constructor keeps the lifecycle co-located with the state it
  manages and makes the service testable in isolation. Putting it in
  `provideFeatureFlags()` would force tests to spin up the full DI tree.

## 5. Tests

`libs/shell/test/feature-flags/feature-flag.service.test.ts` (extending
the existing file; companion `provide-feature-flags.test.ts` updated as
needed):

1. **Inert in `'unknown'` state.** TestBed with `AuthStore.status =
   'unknown'`. Construct `FeatureFlagService`. Assert
   `FEATURE_FLAG_APOLLO_CLIENT.query` is NEVER called and
   `FEATURE_FLAG_APOLLO_CLIENT.subscribe` is NEVER called.
2. **Inert in `'unauthenticated'` state.** Same as above with status set to
   `'unauthenticated'`.
3. **Fires query + subscription on `'authenticated'` transition.** Start in
   `'unknown'`. Construct service. Transition to `'authenticated'`. Assert
   `query` called once with `GET_FEATURE_FLAGS` and `subscribe` called once
   with `ON_FEATURE_FLAG_UPDATE`.
4. **Idempotent across status changes within authenticated.** From
   `'authenticated'`, call `AuthStore.updateUser(...)`. Assert `query` and
   `subscribe` were NOT called a second time.
5. **Logout tears down + resets.** From `'authenticated'`, fire
   `LogoutOrchestrator.resetAll()`. Assert subscription is unsubscribed and
   `FeatureFlagsStore.flags()` is the empty initial state.
6. **Re-login reloads.** Logout, then transition back to `'authenticated'`.
   Assert `query` and `subscribe` called a second time.

## 6. Verification

After implementation:

1. `pnpm nx run shell:test` — 152 (existing) + 6 (new) all green.
2. `pnpm nx run nestfolio-host:test` — 39 existing tests still green
   (no consumer changes expected).
3. `pnpm nx build nestfolio-host` — green; chained
   `assert-shell-html` invariant green.
4. Deploy + cf-smoke unauthenticated: zero `/graphql/investor` requests
   logged at bootstrap; zero `FeatureFlagService:` console.error entries.
5. Manual signed-in smoke (deferred to Playwright Phase 2–10 plan): after
   login, `getFeatureFlags` query fires once and the subscription is live.

cf-smoke 5/5 PASS expected after BOTH Plan F and Plan G land.

## 7. Out of scope

- Visual / UI behaviour during the empty-flag window — no consumer relies
  on a guarded flag at anonymous routes.
- Charter §4 row 11's broader "shell-wired cross-cutting workspace-lib
  singleton" generalisation — the shell-root pattern from E2 is preserved,
  Plan G refines its lifecycle.
- Migration of `GraphqlService.handleAuthFailure` in-flight guard
  (deferred B3 follow-up; tracked separately).
- Apollo Client v4 `onError` deprecation → `ErrorLink` (deferred B3
  follow-up).
- Playwright authenticated smoke (deferred to the Playwright plan resume).

## 8. Commit shape

5 to 7 commits on `feat/g-feature-flags-lazy-after-auth`:

1. `refactor(shell/feature-flags): extract resetFn for logout` — small
   prep commit if needed.
2. `feat(shell/feature-flags): gate load on AuthStore.status === 'authenticated'`
   — the effect.
3. `feat(shell/feature-flags): wire LogoutOrchestrator reset` — teardown
   path.
4. `chore(shell/feature-flags): keep APP_INITIALIZER as inert instantiator`
   — `provideFeatureFlags()` adjusted comment + behavior.
5. `test(shell/feature-flags): add lifecycle tests` — 6 new cases.
6. `docs(shell/feature-flags): record lazy-after-auth contract`.

PR title: `feat(shell/feature-flags): lazy-after-auth lifecycle`.
