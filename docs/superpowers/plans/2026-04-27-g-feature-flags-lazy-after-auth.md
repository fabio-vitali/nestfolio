# Plan G — Lazy-after-auth FeatureFlagService Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `FeatureFlagService` defer its `getFeatureFlags` query and live subscription until `AuthStore.status` transitions into `'authenticated'`. Eliminates the bootstrap 401 on `/graphql/investor` that cf-smoke surfaces on every anonymous run.

**Architecture:** Effect-driven lifecycle inside the service constructor. The constructor sets up an `effect()` watching `AuthStore.status`; on `'authenticated'` (once per session) it calls the existing `loadInitialFlags()` + `subscribeToUpdates()` paths. The constructor also registers a reset fn with `LogoutOrchestrator` that tears down the subscription, clears `FeatureFlagsStore`, and resets the once-per-session guard so a subsequent re-login reloads. `provideFeatureFlags()` keeps a no-op `APP_INITIALIZER` that only instantiates the service so its constructor effect registers.

**Tech Stack:** Angular 21 with zoneless change detection, Angular `effect()` from `@angular/core`, `@ngrx/signals` `AuthStore`, jest with `TestBed.tick()` for flushing effects.

**Spec:** `docs/superpowers/specs/2026-04-27-g-feature-flags-lazy-after-auth-design.md`

**Predecessor:** Plan F (`feat/f-loadmfe-routes-shape`) — must be merged to main before this branch is cut.

---

## File Structure

| File | Action | Responsibility |
| ---- | ------ | -------------- |
| `libs/shell/src/feature-flags/feature-flag.service.ts` | Modify | Effect-driven lifecycle: gate on `AuthStore.status === 'authenticated'`; integrate with `LogoutOrchestrator`. |
| `libs/shell/src/feature-flags/provide-feature-flags.ts` | Modify | Comment + structure tweak; APP_INITIALIZER stays as inert instantiator. |
| `libs/shell/test/feature-flags/feature-flag.service.test.ts` | Modify | Update existing 3 tests to drive `AuthStore` to `'authenticated'`; add 6 new lifecycle tests. |
| `libs/shell/test/feature-flags/provide-feature-flags.test.ts` | Modify | Provide `AuthStore` in TestBed so the service injects cleanly. |

---

## Task 1: Branch from main

**Files:** none (git only)

- [ ] **Step 1: Verify Plan F is merged to main**

Run: `git log --oneline main | head -5`
Expected: A commit titled something like `fix(host): loadMfe returns Routes, not {remoteRoutes}` is reachable from `main`. If not, stop and merge Plan F first.

- [ ] **Step 2: Verify clean working tree on main**

Run: `git status && git rev-parse --abbrev-ref HEAD`
Expected: `On branch main` and `nothing to commit, working tree clean`.

- [ ] **Step 3: Pull latest main**

Run: `git pull --ff-only origin main`
Expected: `Already up to date.` or fast-forward.

- [ ] **Step 4: Create the feature branch**

Run: `git checkout -b feat/g-feature-flags-lazy-after-auth`
Expected: `Switched to a new branch 'feat/g-feature-flags-lazy-after-auth'`.

---

## Task 2: Update existing tests to provide `AuthStore` in `'authenticated'`

The existing 3 tests in `feature-flag.service.test.ts` assume the constructor immediately fires the query/subscription. After Plan G the service gates on `AuthStore.status === 'authenticated'`. We update these tests FIRST so they keep passing through the implementation step (TDD: green → refactor under green).

**Files:**
- Modify: `libs/shell/test/feature-flags/feature-flag.service.test.ts`

- [ ] **Step 1: Read the existing file**

Run: `cat libs/shell/test/feature-flags/feature-flag.service.test.ts`
Note the three existing tests:
- `'queries getFeatureFlags via the injected ApolloClient and pushes to the store'`
- `'subscribes to onFeatureFlagUpdate and pushes incremental updates to the store'`
- `'does NOT inject GraphqlService or MFE_DOMAIN (architectural invariant)'`

- [ ] **Step 2: Add `AuthStore` + `LogoutOrchestrator` to TestBed providers in each existing test**

Edit `libs/shell/test/feature-flags/feature-flag.service.test.ts` so the imports section becomes:

```ts
// Mock ESM-shipped AWS AppSync links so their `export` syntax doesn't
// reach jest's CJS pipeline. The service under test never invokes them —
// we provide the ApolloClient via the FEATURE_FLAG_APOLLO_CLIENT token.
jest.mock('aws-appsync-auth-link', () => ({
  createAuthLink: jest.fn(),
  AUTH_TYPE: { AMAZON_COGNITO_USER_POOLS: 'AMAZON_COGNITO_USER_POOLS' },
}));
jest.mock('aws-appsync-subscription-link', () => ({
  createSubscriptionHandshakeLink: jest.fn(),
}));
jest.mock('aws-amplify/auth', () => ({
  fetchAuthSession: jest.fn().mockResolvedValue({ tokens: { idToken: { toString: () => 'jwt' } } }),
}));

import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { FeatureFlagsStore } from '@nestfolio/ui/feature-flags';
import { AuthStore } from '../../src/stores/auth.store';
import { LogoutOrchestrator } from '../../src/logout-orchestrator';
import { FeatureFlagService } from '../../src/feature-flags/feature-flag.service';
import { FEATURE_FLAG_APOLLO_CLIENT } from '../../src/feature-flags/feature-flag-apollo-client';

interface MockApolloClient {
  query: jest.Mock;
  subscribe: jest.Mock;
  stop: jest.Mock;
}

function makeMockClient(subscriptionEmitter?: Subject<unknown>): MockApolloClient {
  return {
    query: jest.fn().mockResolvedValue({
      data: {
        getFeatureFlags: [
          { name: 'foo', enabled: true, reason: 'default' },
        ],
      },
    }),
    subscribe: jest.fn().mockReturnValue({
      subscribe: (observer: { next: (v: unknown) => void; error: (e: unknown) => void; complete: () => void }) => {
        const sub = (subscriptionEmitter ?? new Subject<unknown>()).subscribe(observer);
        return { unsubscribe: () => sub.unsubscribe() };
      },
    }),
    stop: jest.fn(),
  };
}

const SAMPLE_USER = {
  userId: 'u1',
  username: 'alice',
  email: 'alice@example.com',
  tenantId: 't1',
  onboardingCompletedAt: '2026-01-01T00:00:00Z',
};

/**
 * Drives the synchronous part of the constructor effect plus the microtask
 * queue used by the Apollo client.query promise chain.
 */
async function flushAll(): Promise<void> {
  TestBed.tick();
  await Promise.resolve();
  await Promise.resolve();
}
```

- [ ] **Step 3: Update the first existing test (`queries getFeatureFlags...`)**

Replace the body of the test with:

```ts
  it('queries getFeatureFlags via the injected ApolloClient and pushes to the store after authentication', async () => {
    const client = makeMockClient();
    const setFlags = jest.fn();
    const updateFlag = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: FEATURE_FLAG_APOLLO_CLIENT, useValue: client },
        { provide: FeatureFlagsStore, useValue: { setFlags, updateFlag } },
        FeatureFlagService,
      ],
    });

    TestBed.inject(FeatureFlagService);
    TestBed.inject(AuthStore).setAuthenticated(SAMPLE_USER);
    await flushAll();

    expect(client.query).toHaveBeenCalledTimes(1);
    const queryArg = (client.query as jest.Mock).mock.calls[0][0] as { query: { kind: string } };
    expect(queryArg.query.kind).toBe('Document');
    expect(setFlags).toHaveBeenCalledWith([{ name: 'foo', enabled: true, reason: 'default' }]);
  });
```

- [ ] **Step 4: Update the second existing test (`subscribes to onFeatureFlagUpdate...`)**

Replace its body with:

```ts
  it('subscribes to onFeatureFlagUpdate and pushes incremental updates to the store after authentication', async () => {
    const emitter = new Subject<{ data: { onFeatureFlagUpdate: { name: string; enabled: boolean; reason: string } } }>();
    const client = makeMockClient(emitter);
    const setFlags = jest.fn();
    const updateFlag = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: FEATURE_FLAG_APOLLO_CLIENT, useValue: client },
        { provide: FeatureFlagsStore, useValue: { setFlags, updateFlag } },
        FeatureFlagService,
      ],
    });

    TestBed.inject(FeatureFlagService);
    TestBed.inject(AuthStore).setAuthenticated(SAMPLE_USER);
    await flushAll();

    emitter.next({ data: { onFeatureFlagUpdate: { name: 'bar', enabled: false, reason: 'override' } } });
    expect(updateFlag).toHaveBeenCalledWith({ name: 'bar', enabled: false, reason: 'override' });
  });
```

- [ ] **Step 5: Leave the third existing test (`does NOT inject GraphqlService or MFE_DOMAIN`) unchanged**

The architectural invariant test only asserts `expect(() => TestBed.inject(FeatureFlagService)).not.toThrow()`. Real `AuthStore` and `LogoutOrchestrator` are root-provided in the codebase (`{ providedIn: 'root' }`), so TestBed resolves them without a custom provider.

- [ ] **Step 6: Run the existing tests to confirm they STILL FAIL with the current implementation**

Run: `pnpm nx test shell --testPathPattern=feature-flag.service`
Expected: FAIL on the first two tests (`queries...` and `subscribes...`) — the current implementation calls `client.query` synchronously in the constructor without waiting for `AuthStore.status === 'authenticated'`, so:
- `client.query` is called once at construction (existing behaviour).
- After our change to drive `setAuthenticated`, the test sees the SAME call from before — still 1 call. The assertion `toHaveBeenCalledTimes(1)` passes accidentally.

In other words: these two tests may still pass under the OLD implementation because of the count coincidence. That's fine — we add the new lifecycle tests in Task 3 to prove the gating contract.

The third test (`does NOT inject GraphqlService or MFE_DOMAIN`) must still pass.

- [ ] **Step 7: Commit the test scaffolding**

Run:

```bash
git add libs/shell/test/feature-flags/feature-flag.service.test.ts
git commit -m "$(cat <<'EOF'
test(shell/feature-flags): drive AuthStore in existing service tests

Prepare existing tests to assert post-authentication behaviour. No
behaviour change yet; the gating contract is enforced by lifecycle
tests in the next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add 6 lifecycle tests (TDD: failing first)

**Files:**
- Modify: `libs/shell/test/feature-flags/feature-flag.service.test.ts`

- [ ] **Step 1: Append the 6 new tests inside the existing `describe` block**

After the existing three tests (and inside the same `describe('FeatureFlagService (shell-root, dedicated client)', () => { ... })` block), add:

```ts
  it('is INERT when AuthStore.status is "unknown"', async () => {
    const client = makeMockClient();
    const setFlags = jest.fn();
    const updateFlag = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: FEATURE_FLAG_APOLLO_CLIENT, useValue: client },
        { provide: FeatureFlagsStore, useValue: { setFlags, updateFlag } },
        FeatureFlagService,
      ],
    });

    TestBed.inject(FeatureFlagService);
    // Default AuthStore.status is 'unknown' (initial state). No transition yet.
    await flushAll();

    expect(client.query).not.toHaveBeenCalled();
    expect(client.subscribe).not.toHaveBeenCalled();
    expect(setFlags).not.toHaveBeenCalled();
  });

  it('is INERT when AuthStore.status is "unauthenticated"', async () => {
    const client = makeMockClient();
    const setFlags = jest.fn();
    const updateFlag = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: FEATURE_FLAG_APOLLO_CLIENT, useValue: client },
        { provide: FeatureFlagsStore, useValue: { setFlags, updateFlag } },
        FeatureFlagService,
      ],
    });

    TestBed.inject(FeatureFlagService);
    TestBed.inject(AuthStore).setUnauthenticated();
    await flushAll();

    expect(client.query).not.toHaveBeenCalled();
    expect(client.subscribe).not.toHaveBeenCalled();
    expect(setFlags).not.toHaveBeenCalled();
  });

  it('fires query + subscription exactly once on the "authenticated" transition', async () => {
    const client = makeMockClient();
    const setFlags = jest.fn();
    const updateFlag = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: FEATURE_FLAG_APOLLO_CLIENT, useValue: client },
        { provide: FeatureFlagsStore, useValue: { setFlags, updateFlag } },
        FeatureFlagService,
      ],
    });

    TestBed.inject(FeatureFlagService);
    const authStore = TestBed.inject(AuthStore);

    // Status starts at 'unknown'; transition through 'unauthenticated' → 'authenticated'.
    authStore.setUnauthenticated();
    await flushAll();
    authStore.setAuthenticated(SAMPLE_USER);
    await flushAll();

    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.subscribe).toHaveBeenCalledTimes(1);
  });

  it('does NOT re-fire when user data updates within the authenticated state', async () => {
    const client = makeMockClient();
    const setFlags = jest.fn();
    const updateFlag = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: FEATURE_FLAG_APOLLO_CLIENT, useValue: client },
        { provide: FeatureFlagsStore, useValue: { setFlags, updateFlag } },
        FeatureFlagService,
      ],
    });

    TestBed.inject(FeatureFlagService);
    const authStore = TestBed.inject(AuthStore);
    authStore.setAuthenticated(SAMPLE_USER);
    await flushAll();
    expect(client.query).toHaveBeenCalledTimes(1);

    // Mutate the user without changing status.
    authStore.updateUser({ email: 'alice2@example.com' });
    await flushAll();

    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.subscribe).toHaveBeenCalledTimes(1);
  });

  it('clears FeatureFlagsStore and tears down the subscription on logout', async () => {
    const emitter = new Subject<{ data: { onFeatureFlagUpdate: { name: string; enabled: boolean; reason: string } } }>();
    const client = makeMockClient(emitter);
    const setFlags = jest.fn();
    const updateFlag = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: FEATURE_FLAG_APOLLO_CLIENT, useValue: client },
        { provide: FeatureFlagsStore, useValue: { setFlags, updateFlag } },
        FeatureFlagService,
      ],
    });

    TestBed.inject(FeatureFlagService);
    TestBed.inject(AuthStore).setAuthenticated(SAMPLE_USER);
    await flushAll();

    setFlags.mockClear();
    TestBed.inject(LogoutOrchestrator).resetAll();

    expect(setFlags).toHaveBeenCalledWith([]);

    // Subscription is torn down — emissions after logout must NOT reach the store.
    updateFlag.mockClear();
    emitter.next({ data: { onFeatureFlagUpdate: { name: 'after-logout', enabled: true, reason: 'r' } } });
    expect(updateFlag).not.toHaveBeenCalled();
  });

  it('reloads on a re-login transition after logout', async () => {
    const client = makeMockClient();
    const setFlags = jest.fn();
    const updateFlag = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: FEATURE_FLAG_APOLLO_CLIENT, useValue: client },
        { provide: FeatureFlagsStore, useValue: { setFlags, updateFlag } },
        FeatureFlagService,
      ],
    });

    TestBed.inject(FeatureFlagService);
    const authStore = TestBed.inject(AuthStore);

    authStore.setAuthenticated(SAMPLE_USER);
    await flushAll();
    expect(client.query).toHaveBeenCalledTimes(1);

    // Logout flows through AuthStore.logout() → LogoutOrchestrator.resetAll() → status 'unauthenticated'.
    authStore.logout();
    await flushAll();

    // Re-login: same user or different — irrelevant; the transition is what matters.
    authStore.setAuthenticated(SAMPLE_USER);
    await flushAll();

    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.subscribe).toHaveBeenCalledTimes(2);
  });
```

- [ ] **Step 2: Run the suite to confirm the new tests FAIL**

Run: `pnpm nx test shell --testPathPattern=feature-flag.service`
Expected: At least the first two new tests (`is INERT when AuthStore.status is "unknown"` and `is INERT when AuthStore.status is "unauthenticated"`) FAIL because the current implementation calls `client.query` synchronously in the constructor without checking auth state. The "fires...on authenticated transition" test may pass for the wrong reason (1 call from constructor); the idempotent test will fail (2nd call when status changes); the logout/re-login tests will fail (no LogoutOrchestrator wiring; `setFlags([])` never called).

This proves the test surface exercises the contract being implemented.

---

## Task 4: Refactor `FeatureFlagService` to lazy-after-auth

**Files:**
- Modify: `libs/shell/src/feature-flags/feature-flag.service.ts`

- [ ] **Step 1: Replace the file contents in full**

Edit `libs/shell/src/feature-flags/feature-flag.service.ts` to:

```ts
import { Injectable, OnDestroy, effect, inject, untracked } from '@angular/core';
import { Subscription } from 'rxjs';
import { gql, ApolloClient } from '@apollo/client/core';
import { FeatureFlagsStore, GET_FEATURE_FLAGS, ON_FEATURE_FLAG_UPDATE } from '@nestfolio/ui/feature-flags';
import type { FeatureFlag } from '@nestfolio/ui/feature-flags';
import { AuthStore } from '../stores/auth.store';
import { LogoutOrchestrator } from '../logout-orchestrator';
import { FEATURE_FLAG_APOLLO_CLIENT } from './feature-flag-apollo-client';

/**
 * Shell-root feature-flag lifecycle.
 *
 * The service stays inert until `AuthStore.status` transitions into
 * `'authenticated'`. Anonymous routes (login/signup/confirm) never fire a
 * `getFeatureFlags` query, eliminating the bootstrap 401 against
 * `/graphql/investor`.
 *
 * On logout, `LogoutOrchestrator` invokes the registered reset which tears
 * down the live subscription and clears `FeatureFlagsStore`. A subsequent
 * `'authenticated'` transition reloads cleanly.
 *
 * See docs/superpowers/specs/2026-04-27-g-feature-flags-lazy-after-auth-design.md.
 */
@Injectable()
export class FeatureFlagService implements OnDestroy {
  private readonly store = inject(FeatureFlagsStore);
  private readonly client = inject<ApolloClient>(FEATURE_FLAG_APOLLO_CLIENT);
  private readonly authStore = inject(AuthStore);
  private readonly logoutOrchestrator = inject(LogoutOrchestrator);

  private subscription: Subscription | null = null;
  private loaded = false;
  private readonly resetFn = (): void => this.reset();

  constructor() {
    this.logoutOrchestrator.register(this.resetFn);

    effect(() => {
      const status = this.authStore.status();
      if (status !== 'authenticated' || this.loaded) return;
      this.loaded = true;
      untracked(() => {
        this.loadInitialFlags();
        this.subscribeToUpdates();
      });
    });
  }

  private loadInitialFlags(): void {
    this.client
      .query<{ getFeatureFlags: FeatureFlag[] }>({
        query: gql(GET_FEATURE_FLAGS),
      })
      .then((result) => {
        if (result.data) {
          this.store.setFlags(result.data.getFeatureFlags);
        }
      })
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error('FeatureFlagService: failed to load initial flags', err);
      });
  }

  private subscribeToUpdates(): void {
    const obs = this.client.subscribe<{ onFeatureFlagUpdate: FeatureFlag }>({
      query: gql(ON_FEATURE_FLAG_UPDATE),
    });
    this.subscription = obs.subscribe({
      next: ({ data }: { data: { onFeatureFlagUpdate: FeatureFlag } | null | undefined }) => {
        if (data?.onFeatureFlagUpdate) {
          this.store.updateFlag(data.onFeatureFlagUpdate);
        }
      },
      error: (err: unknown) => {
        // eslint-disable-next-line no-console
        console.error('FeatureFlagService: subscription error', err);
      },
    });
  }

  private reset(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
    this.store.setFlags([]);
    this.loaded = false;
  }

  ngOnDestroy(): void {
    this.logoutOrchestrator.unregister(this.resetFn);
    this.subscription?.unsubscribe();
    this.subscription = null;
  }
}
```

Key contract points:

- `effect()` reads `this.authStore.status()` — Angular tracks the signal read inside the effect. Mutations to `AuthStore.status` re-run the effect.
- `untracked(...)` wraps the actual work so that if `loadInitialFlags()` or `subscribeToUpdates()` were ever to read other signals, those reads would NOT re-trigger the effect.
- `this.loaded` is the once-per-session guard. It is reset by `this.reset()` when `LogoutOrchestrator.resetAll()` fires, so a re-login transitions `'authenticated'` → guard cleared → effect re-fires → reload.
- On `ngOnDestroy`, the service unregisters its reset fn so `LogoutOrchestrator` no longer holds the closure.

- [ ] **Step 2: Run the full feature-flag service test suite**

Run: `pnpm nx test shell --testPathPattern=feature-flag.service`
Expected: PASS — all 9 tests green (3 existing + 6 new).

If a test fails on `TestBed.tick()` not being available, fall back to importing `flushEffects` from `@angular/core/testing` (Angular 18+) or replace with `TestBed.inject(ApplicationRef).tick()`. Confirm the project's Angular version with `cat package.json | grep '"@angular/core"'` first.

---

## Task 5: Verify `provide-feature-flags.test.ts` still passes

`provideFeatureFlags()` injects `FeatureFlagService` from the APP_INITIALIZER. The new service constructor injects `AuthStore` (root) and `LogoutOrchestrator` (root) — both already root-provided in the codebase, so no TestBed change is needed. But the test's APP_INITIALIZER runs `inject(FeatureFlagService)` which now triggers an `effect()` registration; that's still synchronous and harmless.

**Files:**
- Inspect: `libs/shell/test/feature-flags/provide-feature-flags.test.ts`

- [ ] **Step 1: Run the file**

Run: `pnpm nx test shell --testPathPattern=provide-feature-flags`
Expected: PASS — 3 tests green. If the `APP_INITIALIZER` test triggers an unhandled effect or the client tries to actually query (the real Apollo client is provided via the factory), that's fine because `AuthStore.status` defaults to `'unknown'` — the effect short-circuits and never calls `client.query`.

If a test fails because the real Apollo client tries to talk to a real network at construction time, mock the inject token:

```ts
{
  provide: FEATURE_FLAG_APOLLO_CLIENT,
  useValue: { query: jest.fn(), subscribe: jest.fn(), stop: jest.fn() },
},
```

Add this BEFORE `provideFeatureFlags()` in the providers array of the failing test. (Real-instance creation is a separate concern handled by the dedicated `'provides FEATURE_FLAG_APOLLO_CLIENT as an ApolloClient instance'` test.)

---

## Task 6: Run the full shell test suite + lint + build

**Files:** none

- [ ] **Step 1: Run all shell unit tests**

Run: `pnpm nx test shell`
Expected: PASS — 152 (existing) + 6 (new) = 158 tests green. (Existing 3 still count, but their semantic shifted — total is still the prior 152 + 6 new = 158.)

- [ ] **Step 2: Run shell lint**

Run: `pnpm nx lint shell`
Expected: PASS — zero new errors.

- [ ] **Step 3: Run host tests (no expected change)**

Run: `pnpm nx test nestfolio-host`
Expected: PASS — 39+ tests green; nothing should regress because `FeatureFlagService`'s public surface is unchanged.

- [ ] **Step 4: Run host build (chained `assert-shell-html` invariant)**

Run: `pnpm nx build nestfolio-host`
Expected: PASS — build completes; chained `assert-shell-html` invariant green.

---

## Task 7: Commit the implementation + tests

**Files:** none (git only)

- [ ] **Step 1: Stage all changes**

Run:

```bash
git add libs/shell/src/feature-flags/feature-flag.service.ts \
        libs/shell/test/feature-flags/feature-flag.service.test.ts \
        libs/shell/test/feature-flags/provide-feature-flags.test.ts
```

(Include `provide-feature-flags.test.ts` only if Task 5 required edits.)

- [ ] **Step 2: Verify the staged diff**

Run: `git diff --staged --stat`
Expected: 2 to 3 files listed.

- [ ] **Step 3: Create the commit**

Run:

```bash
git commit -m "$(cat <<'EOF'
feat(shell/feature-flags): lazy-after-auth lifecycle

FeatureFlagService is now driven by an effect watching
AuthStore.status. The query + subscription fire only when status
transitions to 'authenticated', and only once per session (a #loaded
guard prevents re-firing on user-updates). On logout the registered
LogoutOrchestrator reset tears down the subscription and clears
FeatureFlagsStore; a re-login transition reloads cleanly.

Eliminates the bootstrap 401 on /graphql/investor that cf-smoke
flagged on every anonymous route post Plan E2.

provideFeatureFlags() keeps a no-op APP_INITIALIZER so the service is
instantiated at startup and its constructor effect registers; no
network at bootstrap.

Spec: docs/superpowers/specs/2026-04-27-g-feature-flags-lazy-after-auth-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Deploy + cf-smoke verification

**Files:** none (operational verification)

- [ ] **Step 1: Confirm AWS Leapp credentials are loaded**

Run: `aws sts get-caller-identity`
Expected: Returns the `AdminRole` identity for account `771924376645`. If not, sign in via Leapp first.

- [ ] **Step 2: Deploy investor-web (chained shell deploy)**

Run: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-web`
Expected: investor-web stack synth + deploy succeeds; Phase 4b's `nestfolio-host:config` → `nestfolio-host:build` → `deploy-shell.sh` chain runs and uploads the new shell bundle.

If the local Nx cache serves a stale build (Plan E lesson), bypass:
`pnpm nx run nestfolio-host:build --skip-nx-cache && bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-web`.

- [ ] **Step 3: Run cf-smoke**

Run: `pnpm cf-smoke --prefix=dev`
Expected: PASS — `cf-smoke: PASS (5/5 routes)`. Per-route: `consoleErrors=0`, `requestFailures=0`, `rendered=true`, `status=200`.

If FAIL persists, read the per-route output. Plausible new failure shapes:
- New CSP entries appear (cf-smoke does not check CSP, so unlikely).
- A different lazy-load chunk error (would indicate Plan F regression — investigate before patching).

- [ ] **Step 4: Push the branch + open PR**

Run: `git push -u origin feat/g-feature-flags-lazy-after-auth`

Then create the PR:

```bash
gh pr create --title "feat(shell/feature-flags): lazy-after-auth lifecycle" --body "$(cat <<'EOF'
## Summary
- `FeatureFlagService` waits for `AuthStore.status === 'authenticated'` before firing its `getFeatureFlags` query and subscription.
- `LogoutOrchestrator` reset tears down the subscription and clears `FeatureFlagsStore` on logout. Re-login reloads cleanly.
- `provideFeatureFlags()` keeps a no-op `APP_INITIALIZER` (instantiator only) — no network at bootstrap.
- Eliminates the cf-smoke bootstrap 401 on `/graphql/investor` and graduates cf-smoke to 5/5 PASS (combined with Plan F).

Spec: `docs/superpowers/specs/2026-04-27-g-feature-flags-lazy-after-auth-design.md`

## Test plan
- [x] `pnpm nx test shell` — 158 tests green (152 existing + 6 new lifecycle tests)
- [x] `pnpm nx test nestfolio-host` — green (no consumer regressions)
- [x] `pnpm nx lint shell` — green
- [x] `pnpm nx build nestfolio-host` — green (chained `assert-shell-html`)
- [x] Deployed `investor-web --prefix=dev` and ran `pnpm cf-smoke --prefix=dev` — 5/5 PASS

## Charter graduation
Combined with Plan F, the MFE charter migration is **fully graduated**: cf-smoke 5/5 PASS on the deployed dev CloudFront.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Checklist

Before handoff:

1. **Spec coverage:**
   - Spec §3.1 (effect-driven lifecycle) → Task 4 (`effect(()=>{...})` body).
   - Spec §3.2 (logout integration) → Task 4 (`logoutOrchestrator.register(this.resetFn)` + `reset()`).
   - Spec §3.3 (`provideFeatureFlags()` shape) → no code change needed; existing shape already matches; Task 5 verifies still-passes.
   - Spec §5 (six lifecycle tests) → Task 3.
   - Spec §6 (verification) → Tasks 6 + 8.
   - Spec §8 (commit shape) → Tasks 2 + 7 (2 commits — test scaffolding + implementation; smaller than the spec's 5–7 estimate but cleaner for review).
2. **No placeholders:** All code blocks complete; all commands runnable.
3. **Type consistency:** `loadInitialFlags`/`subscribeToUpdates`/`reset`/`resetFn` named identically across the implementation and the test assertions. `AuthStore.status` signal is the same one read by `effect()` and driven by `setAuthenticated`/`setUnauthenticated`/`logout` in tests.
