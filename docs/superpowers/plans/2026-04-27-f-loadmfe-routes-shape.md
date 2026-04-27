# Plan F — `loadMfe` returns `Routes`, not `{remoteRoutes}` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the host's `loadChildren` resolver so it returns a `Routes` array (the shape Angular Router accepts) instead of `{ remoteRoutes: Routes }` (which Router does not recognise and which caused `TypeError: Cannot read properties of null (reading 'bootstrap')` on every cf-smoke run).

**Architecture:** Single-file change in `apps/nestfolio-host/src/app/app.routes.ts`. The MFE-side `export const remoteRoutes: Routes` stays unchanged; the host's resolver unwraps that named export. Matches the canonical Native Federation pattern from the Angular Architects samples.

**Tech Stack:** Angular 21 router (`@angular/router`), Native Federation (`@angular-architects/native-federation`), jest + jest-preset-angular for tests.

**Spec:** `docs/superpowers/specs/2026-04-27-f-loadmfe-routes-shape-design.md`

---

## File Structure

| File | Action | Responsibility |
| ---- | ------ | -------------- |
| `apps/nestfolio-host/src/app/app.routes.ts` | Modify | `loadMfe()` unwraps `m.remoteRoutes`; catch fallback returns `Routes`. |
| `apps/nestfolio-host/test/app/app.routes.spec.ts` | Create | TDD spec for the resolver contract. |

---

## Task 1: Branch from main

**Files:** none (git only)

- [ ] **Step 1: Verify clean working tree on main**

Run: `git status && git rev-parse --abbrev-ref HEAD`
Expected: `On branch main` and `nothing to commit, working tree clean`. If not on main, run `git checkout main` first.

- [ ] **Step 2: Pull latest main**

Run: `git pull --ff-only origin main`
Expected: Either `Already up to date.` or a fast-forward update.

- [ ] **Step 3: Create the feature branch**

Run: `git checkout -b feat/f-loadmfe-routes-shape`
Expected: `Switched to a new branch 'feat/f-loadmfe-routes-shape'`.

---

## Task 2: Add failing spec for the resolver contract

**Files:**
- Create: `apps/nestfolio-host/test/app/app.routes.spec.ts`

- [ ] **Step 1: Inspect existing test layout**

Run: `ls apps/nestfolio-host/test/app/`
Expected output includes: `app.component.spec.ts`, `app.config.spec.ts`, `mfe-error.component.spec.ts`. The `.spec.ts` extension is the convention for this project.

- [ ] **Step 2: Read the current resolver to understand the export surface**

Run: `cat apps/nestfolio-host/src/app/app.routes.ts | head -15`
Note: `loadMfe` is a **module-private** helper (not exported). The spec must exercise it through the route configs, OR the implementation task will export it. We will export it (Task 3) so the spec can call it directly — much simpler than reaching into the route config tree.

- [ ] **Step 3: Create the spec file**

Create `apps/nestfolio-host/test/app/app.routes.spec.ts` with this exact content:

```ts
jest.mock('@angular-architects/native-federation', () => ({
  loadRemoteModule: jest.fn(),
}));

import { loadRemoteModule } from '@angular-architects/native-federation';
import type { Routes } from '@angular/router';
import { loadMfe } from '../../src/app/app.routes';
import { MfeErrorComponent } from '../../src/app/mfe-error.component';

const mockedLoadRemoteModule = loadRemoteModule as jest.MockedFunction<typeof loadRemoteModule>;

describe('loadMfe()', () => {
  beforeEach(() => {
    mockedLoadRemoteModule.mockReset();
  });

  it('unwraps m.remoteRoutes and returns a Routes array on success', async () => {
    const fakeRoutes: Routes = [
      { path: 'foo', loadComponent: async () => class FakeComponent {} },
    ];
    mockedLoadRemoteModule.mockResolvedValue({ remoteRoutes: fakeRoutes });

    const resolver = loadMfe('investor-mfe', './routes');
    const result = await resolver();

    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual(fakeRoutes);
  });

  it('returns the MfeErrorComponent fallback Routes array on failure', async () => {
    mockedLoadRemoteModule.mockRejectedValue(new Error('remote unreachable'));

    const resolver = loadMfe('investor-mfe', './routes');
    const result = await resolver();

    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([{ path: '**', component: MfeErrorComponent }]);
  });

  it('always returns a Routes array, never an object wrapper', async () => {
    mockedLoadRemoteModule.mockResolvedValue({ remoteRoutes: [] });
    const resolverOk = loadMfe('investor-mfe', './routes');
    expect(Array.isArray(await resolverOk())).toBe(true);

    mockedLoadRemoteModule.mockRejectedValue(new Error('boom'));
    const resolverErr = loadMfe('investor-mfe', './routes');
    expect(Array.isArray(await resolverErr())).toBe(true);
  });
});
```

- [ ] **Step 4: Run the spec to verify it fails**

Run: `pnpm nx test nestfolio-host --testPathPattern=app.routes.spec`
Expected: FAIL — three failing assertions, with errors mentioning either `loadMfe is not a function` or `loadMfe is not exported from '../../src/app/app.routes'`. This proves the test exercises the to-be-implemented contract.

---

## Task 3: Fix the resolver

**Files:**
- Modify: `apps/nestfolio-host/src/app/app.routes.ts`

- [ ] **Step 1: Replace the `loadMfe` helper**

Edit `apps/nestfolio-host/src/app/app.routes.ts` so it reads:

```ts
import { Route, Routes } from '@angular/router';
import { loadRemoteModule } from '@angular-architects/native-federation';
import { authGuard, onboardingPendingGuard, onboardingCompletedGuard } from '@nestfolio/shell/auth';
import { provideMfeGraphql } from '@nestfolio/shell/graphql';
import { MfeErrorComponent } from './mfe-error.component';

// Native Federation contract: each MFE exposes `export const remoteRoutes: Routes`
// from its `./routes` entry. Angular Router's `loadChildren` accepts a `Routes`
// array (or NgModule shapes) — NOT a `{ remoteRoutes: Routes }` wrapper.
// Returning the wrapper makes Router fall through to the legacy NgModule path
// and crash with `TypeError: Cannot read properties of null (reading 'bootstrap')`.
// See docs/superpowers/specs/2026-04-27-f-loadmfe-routes-shape-design.md.
export function loadMfe(remoteName: string, exposedModule: string) {
  return () =>
    loadRemoteModule(remoteName, exposedModule)
      .then((m) => (m as { remoteRoutes: Routes }).remoteRoutes)
      .catch((): Routes => [{ path: '**', component: MfeErrorComponent }]);
}

export const appRoutes: Route[] = [
  {
    path: 'login',
    loadComponent: () => import('./auth/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'signup',
    loadComponent: () => import('./auth/signup.component').then((m) => m.SignupComponent),
  },
  {
    path: 'confirm',
    loadComponent: () => import('./auth/confirm.component').then((m) => m.ConfirmComponent),
  },
  {
    // No provideMfeGraphql — onboarding-bff has no Facade / AppSync API; the
    // onboarding-mfe drives the CopilotKit bridge at /api/copilotkit*.
    // Documented exception per charter A3 + spec §6.7.
    path: 'onboarding',
    canActivate: [authGuard, onboardingPendingGuard],
    loadChildren: loadMfe('onboarding-mfe', './routes'),
  },
  {
    path: 'investor',
    providers: [provideMfeGraphql('investor')],
    canActivate: [authGuard, onboardingCompletedGuard],
    loadChildren: loadMfe('investor-mfe', './routes'),
  },
  {
    path: 'dashboard',
    providers: [provideMfeGraphql('dashboard')],
    canActivate: [authGuard, onboardingCompletedGuard],
    loadChildren: loadMfe('dashboard-mfe', './routes'),
  },
  {
    path: 'advisory',
    providers: [provideMfeGraphql('advisory')],
    canActivate: [authGuard, onboardingCompletedGuard],
    loadChildren: loadMfe('advisory-mfe', './routes'),
  },
  {
    path: 'ledger',
    providers: [provideMfeGraphql('ledger')],
    canActivate: [authGuard, onboardingCompletedGuard],
    loadChildren: loadMfe('ledger-mfe', './routes'),
  },
  {
    path: '',
    redirectTo: 'dashboard',
    pathMatch: 'full',
  },
  {
    path: '**',
    redirectTo: 'dashboard',
  },
];
```

Two changes from the current file:

1. **`Routes`** added to the `@angular/router` import (alongside `Route`).
2. **`loadMfe`** is now `export function` (was a private function), with the `.then((m) => m.remoteRoutes)` unwrap and a typed `Routes` return on the catch path. The leading comment block is the only documentation needed.

- [ ] **Step 2: Run the spec to verify it passes**

Run: `pnpm nx test nestfolio-host --testPathPattern=app.routes.spec`
Expected: PASS — three tests green.

---

## Task 4: Run the full host test suite

**Files:** none

- [ ] **Step 1: Run all nestfolio-host unit tests**

Run: `pnpm nx test nestfolio-host`
Expected: PASS — 39 + 3 = 42 tests green (or whatever the existing baseline is, plus 3 new). No regressions.

- [ ] **Step 2: Run host lint**

Run: `pnpm nx lint nestfolio-host`
Expected: PASS — zero new errors. Pre-existing warnings (e.g. `any` warnings in test files) acceptable; no NEW warnings introduced.

- [ ] **Step 3: Run host build (chained `assert-shell-html` invariant)**

Run: `pnpm nx build nestfolio-host`
Expected: PASS — build completes; chained `assert-shell-html` invariant target green; no charter-path literals leak.

---

## Task 5: Commit

**Files:** none (git only)

- [ ] **Step 1: Stage the changes**

Run: `git add apps/nestfolio-host/src/app/app.routes.ts apps/nestfolio-host/test/app/app.routes.spec.ts`

- [ ] **Step 2: Verify the staged diff**

Run: `git diff --staged --stat`
Expected: Two files listed — the modified `app.routes.ts` and the new `app.routes.spec.ts`.

- [ ] **Step 3: Create the commit**

Run:

```bash
git commit -m "$(cat <<'EOF'
fix(host): loadMfe returns Routes, not {remoteRoutes}

loadRemoteModule resolves to the MFE's full module exports object,
e.g. { remoteRoutes: Routes }. Angular Router's loadChildren contract
accepts Routes | Type<NgModule> | NgModuleFactory | { default: ... };
the {remoteRoutes:...} wrapper falls through to the legacy NgModule
path, dereferences a null module reference, and crashes with
TypeError: Cannot read properties of null (reading 'bootstrap').

Unwrap m.remoteRoutes in the host resolver. Catch path now returns a
Routes array shape too. No MFE-side changes.

Spec: docs/superpowers/specs/2026-04-27-f-loadmfe-routes-shape-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: A new commit on `feat/f-loadmfe-routes-shape` with two files changed.

---

## Task 6: Deploy + cf-smoke verification

**Files:** none (operational verification)

- [ ] **Step 1: Confirm AWS Leapp credentials are loaded**

Run: `aws sts get-caller-identity`
Expected: Returns the `AdminRole` identity for account `771924376645`. If not, sign in via Leapp first.

- [ ] **Step 2: Deploy investor-web (chained shell deploy)**

Run: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-web`
Expected: investor-web stack synth + deploy succeeds; Phase 4b's `nestfolio-host:config` → `nestfolio-host:build` → `deploy-shell.sh` chain runs and uploads the new shell bundle to the shell S3 bucket.

- [ ] **Step 3: Run cf-smoke**

Run: `pnpm cf-smoke --prefix=dev`
Expected: The `TypeError: Cannot read properties of null (reading 'bootstrap')` is GONE on all 5 routes. cf-smoke will STILL report `FAIL` because the FeatureFlagService bootstrap 401 (Issue 1) remains — that is Plan G's scope. Verify the failure shape is now ONLY:

- `requestfailed: https://.../graphql/investor (HTTP 401)` (1 per route)
- `console.error: Failed to load resource: the server responded with a status of 401 ()` (1 per route)
- `console.error: FeatureFlagService: failed to load initial flags ServerError: ...` (1 per route)

Total `consoleErrors` should drop from 3 → 2 per route, and the GlobalErrorHandler unhandled-error entry must NOT appear.

- [ ] **Step 4: Push the branch + open PR**

Run: `git push -u origin feat/f-loadmfe-routes-shape`
Then create the PR:

```bash
gh pr create --title "fix(host): unwrap m.remoteRoutes in loadChildren resolver" --body "$(cat <<'EOF'
## Summary
- Host's `loadMfe()` now unwraps `m.remoteRoutes` and returns a `Routes` array (Angular Router's accepted shape) instead of `{ remoteRoutes: Routes }`.
- Catch fallback updated to the same `Routes` shape.
- Drops the `TypeError: Cannot read properties of null (reading 'bootstrap')` cf-smoke reported on all 5 routes after Plans D + E + E2.
- Three new jest specs in `apps/nestfolio-host/test/app/app.routes.spec.ts` cover the success path, failure path, and array-shape invariant.

Spec: `docs/superpowers/specs/2026-04-27-f-loadmfe-routes-shape-design.md`

## Test plan
- [x] `pnpm nx test nestfolio-host` — green
- [x] `pnpm nx lint nestfolio-host` — green
- [x] `pnpm nx build nestfolio-host` — green (chained `assert-shell-html`)
- [x] Deployed `investor-web --prefix=dev` and ran `pnpm cf-smoke --prefix=dev` — `TypeError ... 'bootstrap'` is gone; remaining `FAIL` is Plan G scope (FeatureFlagService 401 at bootstrap)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

---

## Self-Review Checklist

Before handoff:

1. **Spec coverage:**
   - Spec §3 (the fix) → Task 3.
   - Spec §6 (tests) → Task 2.
   - Spec §7 (verification) → Tasks 4 + 6.
   - Spec §8 (commit shape) → Task 5.
2. **No placeholders:** All code blocks complete; all commands runnable; no "implement later".
3. **Type consistency:** `loadMfe` exported with the same signature in Task 2 (test imports) and Task 3 (implementation).
