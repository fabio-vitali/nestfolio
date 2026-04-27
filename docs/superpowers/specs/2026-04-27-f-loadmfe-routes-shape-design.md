# Plan F — `loadMfe` returns `Routes`, not `{remoteRoutes}`

**Date:** 2026-04-27
**Status:** Design (approved)
**Branch target:** `feat/f-loadmfe-routes-shape` (cut from `main`)
**Predecessor:** Plan E2 (`2026-04-27-e2-feature-flags-shell-root-client.md`)
**Successor:** Plan G — `2026-04-27-g-feature-flags-lazy-after-auth-design.md`

---

## 1. Problem

`pnpm cf-smoke --prefix=dev` against the deployed dev CloudFront FAILS 5/5 routes
with an identical `TypeError` on each:

```
TypeError: Cannot read properties of null (reading 'bootstrap')
  at new jn (https://.../_angular_core.-38qeN2GIj.js:3103:134)
  at Vn.create (https://.../_angular_core.-38qeN2GIj.js:3111:24)
  at https://.../_angular_router.rlKm5L12Tk.js:964:299
  at Generator.next (<anonymous>)
  at f (https://.../chunk-G6LNOBMT.js:21:9)
```

The error fires before any MFE chunk fetches and is independent of route, auth
state, or runtime config. cf-smoke captures the page URL as `/` (root), meaning
the error happens during the FIRST navigation Angular Router resolves after
bootstrap.

## 2. Root cause

`apps/nestfolio-host/src/app/app.routes.ts:7-12` defines the host's
`loadChildren` resolver:

```ts
function loadMfe(remoteName: string, exposedModule: string) {
  return () =>
    loadRemoteModule(remoteName, exposedModule).catch(() => ({
      remoteRoutes: [{ path: '**', component: MfeErrorComponent }],
    }));
}
```

`loadRemoteModule()` returns the resolved module's exports object verbatim. All
five MFEs export their routes as `export const remoteRoutes: Routes` (e.g.
`apps/investor-mfe/src/app/remote-routes.ts:6`,
`apps/dashboard-mfe/src/app/remote-routes.ts:3`, etc.). So the success path
resolves to `{ remoteRoutes: Routes }`. The catch fallback uses the same
malformed shape.

Angular Router's `loadChildren` contract accepts:

| Shape                           | Status        |
| ------------------------------- | ------------- |
| `Routes` (array)                | ✅ accepted    |
| `Type<unknown>` (NgModule class) | ✅ accepted    |
| `NgModuleFactory<unknown>`      | ✅ accepted    |
| `{ default: Routes \| Type }`   | ✅ accepted    |
| `{ remoteRoutes: Routes }`      | ❌ unrecognised |
| `{ routes: Routes }`            | ❌ unrecognised |

When the resolver returns the unrecognised object, Angular Router falls through
to the legacy NgModule path (`_angular_router.js:964:299`), constructing an
injector against a null module reference and dereferencing `.bootstrap` →
TypeError.

This bug has existed since the host was first wired against Native Federation;
it was previously masked by upstream bootstrap crashes (Plans D, E, E2). Plans
E + E2 graduated those crashes, exposing this latent bug.

## 3. Fix

Unwrap `remoteRoutes` in the host resolver, returning a `Routes` array
directly. Apply the same shape on the catch path.

`apps/nestfolio-host/src/app/app.routes.ts`:

```ts
import { Route, Routes } from '@angular/router';
import { loadRemoteModule } from '@angular-architects/native-federation';
// ... existing imports ...

function loadMfe(remoteName: string, exposedModule: string) {
  return () =>
    loadRemoteModule(remoteName, exposedModule)
      .then((m) => m.remoteRoutes as Routes)
      .catch((): Routes => [{ path: '**', component: MfeErrorComponent }]);
}
```

The `as Routes` cast is necessary because `loadRemoteModule`'s return type is
`Promise<unknown>` — there is no compile-time contract on what an MFE exposes.
The cast localises the duck-typed contract to a single line.

No MFE-side changes. Each MFE keeps `export const remoteRoutes: Routes` as-is.

## 4. Why this shape

This matches the canonical Native Federation example
(Manfred Steyer / Angular Architects samples and tutorials):

```ts
loadChildren: () =>
  loadRemoteModule('flights', './Module').then((m) => m.FlightsRoutes),
```

The convention across the Native Federation ecosystem is:

1. The MFE exposes a **named** routes constant (`FlightsRoutes`,
   `remoteRoutes`, etc.) under a stable key.
2. The host's `loadChildren` resolver **unwraps** that named export.

Returning the module exports object verbatim is the bug; the unwrap is the
contract.

## 5. Out of scope

- MFE-side renames (`remoteRoutes` → `routes` etc.) — purely cosmetic, would
  churn 5 files for no functional benefit.
- A typed `MfeRoutesModule` interface or shared type guard — the duck-typed
  `m.remoteRoutes` access is acceptable: a malformed MFE export would surface
  as a runtime error caught by the existing `.catch()` fallback, which is
  exactly the desired behaviour. Premature abstraction.
- Auth-state-driven gating of `loadChildren` (e.g. blocking MFE chunks for
  unauthenticated users) — orthogonal concern.
- The `FeatureFlagService` 401 at bootstrap — addressed by Plan G.

## 6. Tests

A single new jest spec covers the resolver contract:

`apps/nestfolio-host/test/app/app.routes.spec.ts`

Test cases (jest, matching the existing `nestfolio-host` jest config —
`apps/nestfolio-host/jest.config.ts`):

1. **Success path returns `Routes`.** `jest.mock('@angular-architects/native-federation', () => ({ loadRemoteModule: jest.fn() }))`.
   Resolve with `{ remoteRoutes: [{ path: 'foo', component: FakeComponent }] }`.
   Invoke the resolver. Assert the returned value equals
   `[{ path: 'foo', component: FakeComponent }]` (NOT the wrapper object).
2. **Failure path returns `Routes`.** Reject the mocked
   `loadRemoteModule`. Invoke the resolver. Assert the returned value
   equals `[{ path: '**', component: MfeErrorComponent }]`.
3. **Both paths produce arrays, not objects.** `expect(Array.isArray(await
   resolver())).toBe(true)` for both branches.

## 7. Verification

After implementation:

1. `pnpm nx run-many -t lint test --projects=nestfolio-host` — green.
2. `pnpm nx build nestfolio-host` (chained `assert-shell-html` invariant) —
   green.
3. Deploy: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev
   --services=investor-web` (Phase 4b will run the chained shell deploy).
4. `pnpm cf-smoke --prefix=dev` — the `TypeError: Cannot read properties of
   null (reading 'bootstrap')` is GONE on all 5 routes.

The 401 from `FeatureFlagService` will still fire (Plan G scope). cf-smoke
will still report `FAIL` until Plan G lands; that is expected.

## 8. Commit shape

1 to 2 commits on `feat/f-loadmfe-routes-shape`:

- `fix(host): loadMfe returns Routes, not {remoteRoutes}` — code change +
  test.
- (optional) `docs(host): record loadChildren shape contract in
  app.routes.ts` — short comment above `loadMfe()` linking to this spec.

PR title: `fix(host): unwrap m.remoteRoutes in loadChildren resolver`.
