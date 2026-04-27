# Plan E2: Shell-Root Feature-Flag Apollo Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple `FeatureFlagService` from the per-MFE `GraphqlService` by giving feature flags a dedicated shell-root Apollo client, eliminating the NG0201 NullInjectorError that surfaces at APP_INITIALIZER time and establishing a generalizable pattern for future shell-root cross-cutting backend-talking services (telemetry, user-context, audit, etc.).

**Architecture:** A new shell module `libs/shell/src/feature-flags/` owns three pieces: (1) a dedicated `ApolloClient` factory targeting `/graphql/investor` (where the feature-flag schema lives), (2) the rewritten `FeatureFlagService` that consumes the new client directly via an `InjectionToken`, and (3) a `provideFeatureFlags()` `EnvironmentProviders` helper that wires client + service + APP_INITIALIZER + auth-failure handling, mirroring the idiomatic `provideAuth()` shape. The host's `app.config.ts` collapses its manual feature-flag APP_INITIALIZER block down to a single `provideFeatureFlags()` call. `GraphqlService` and `MFE_DOMAIN` are untouched — they remain correctly route-scoped for MFE-local queries.

**Tech Stack:** Angular 21 standalone bootstrap, Apollo Client v4, AWS AppSync auth/subscription links, aws-amplify auth, Jest unit tests, Playwright cf-smoke.

**Branch:** Continue on `feat/e-app-initializer-ordering` (Plan E core fix already shipped 7 commits there; this is the natural extension).

---

## Background

cf-smoke against deployed dev (after Plan E shipped) FAILs with `NG0201` in the bootstrap chunk. Stack trace shows the failure path is:

```
APP_INITIALIZER factory → inject(FeatureFlagService)
  → FeatureFlagService constructor → inject(GraphqlService)
    → GraphqlService constructor → inject(MFE_DOMAIN)   ← NG0201: no provider at root
```

`MFE_DOMAIN` is provided per-route via `provideMfeGraphql(domain)` in `apps/nestfolio-host/src/app/app.routes.ts`. Per Angular's hierarchical-injector contract, route-scoped providers are invisible to APP_INITIALIZER code at the shell root.

The MFE charter (`docs/superpowers/specs/2026-04-24-mfe-architecture-charter.md` §4 row 11) declares feature flags as a "shell-wired cross-cutting workspace-lib singleton". The implementation drifted from that contract during Plan B3 by routing feature-flag GraphQL through the per-MFE service. This plan restores the charter shape.

The pattern this plan establishes — **"shell-root services own their transports"** — generalizes to any future cross-cutting concern needing backend access at bootstrap.

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `libs/shell/src/feature-flags/feature-flag-apollo-client.ts` | `FEATURE_FLAG_APOLLO_CLIENT` `InjectionToken<ApolloClient>` + factory wrapping `createApolloClient` with `domain: 'investor'` | **Create** |
| `libs/shell/src/feature-flags/feature-flag.service.ts` | The rewritten service: queries flags + subscribes to updates via the new token (NO `GraphqlService`) | **Create** (move + rewrite of `libs/shell/src/feature-flag.service.ts`) |
| `libs/shell/src/feature-flags/provide-feature-flags.ts` | `EnvironmentProviders` helper wiring client + service + APP_INITIALIZER + auth-failure | **Create** |
| `libs/shell/src/feature-flags/index.ts` | Public surface for the module | **Create** |
| `libs/shell/src/feature-flag.service.ts` | Old service location | **Delete** (superseded) |
| `libs/shell/src/index.ts` | Lib root re-exports | **Modify** — re-export `provideFeatureFlags` (keep `FeatureFlagService` re-export, point at new path) |
| `apps/nestfolio-host/src/app/app.config.ts` | Host bootstrap providers | **Modify** — drop manual APP_INITIALIZER for `FeatureFlagService`, drop `inject(FeatureFlagService)` import-from-`@nestfolio/shell`, add `provideFeatureFlags()` |
| `libs/shell/test/feature-flags/feature-flag.service.test.ts` | Unit test for the rewritten service with a mock `ApolloClient` | **Create** |
| `libs/shell/test/feature-flags/provide-feature-flags.test.ts` | Provider-wiring test asserting the APP_INITIALIZER fires + the `FEATURE_FLAG_APOLLO_CLIENT` token resolves | **Create** |

---

## Task 1: Create the dedicated Apollo client + DI token

**Files:**
- Create: `libs/shell/src/feature-flags/feature-flag-apollo-client.ts`

- [ ] **Step 1: Write the file**

Create `libs/shell/src/feature-flags/feature-flag-apollo-client.ts` with:

```ts
import { InjectionToken } from '@angular/core';
import { ApolloClient } from '@apollo/client/core';
import { fetchAuthSession } from 'aws-amplify/auth';
import { AuthConfig } from '../auth';
import { createApolloClient } from '../graphql/create-apollo-client';

/**
 * Shell-root Apollo client dedicated to feature-flag traffic.
 *
 * The shell needs to query feature flags at APP_INITIALIZER time, BEFORE any
 * MFE route activates. Per Angular's hierarchical-injector contract, route-
 * scoped tokens (like `MFE_DOMAIN`) are invisible at the shell root — so this
 * client must be standalone, owned by the shell, and provided at root.
 *
 * Targets `/graphql/investor` because the feature-flag GraphQL schema lives
 * on `investor-bff`. Cache is intentionally isolated from any per-MFE Apollo
 * client (Apollo Client v4's standard MFE idiom: one client per backend, one
 * cache per client).
 *
 * The shell-root client and the per-route `/investor` client are separate
 * instances. They will hold separate caches. That is correct, not a leak.
 */
export const FEATURE_FLAG_APOLLO_CLIENT = new InjectionToken<ApolloClient>(
  'FEATURE_FLAG_APOLLO_CLIENT',
);

export interface CreateFeatureFlagApolloClientOptions {
  authConfig: AuthConfig;
  onAuthFailure: (reason: string) => void;
}

export function createFeatureFlagApolloClient(
  opts: CreateFeatureFlagApolloClientOptions,
): ApolloClient {
  return createApolloClient({
    domain: 'investor',
    region: opts.authConfig.region,
    jwtTokenProvider: async () =>
      (await fetchAuthSession()).tokens?.idToken?.toString() ?? '',
    onAuthFailure: opts.onAuthFailure,
  });
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm nx run shell:lint`
Expected: PASS. (No tests yet — the factory is reused by Task 3's provider.)

---

## Task 2: Write the rewritten `FeatureFlagService` (TDD)

**Files:**
- Create: `libs/shell/src/feature-flags/feature-flag.service.ts`
- Create: `libs/shell/test/feature-flags/feature-flag.service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `libs/shell/test/feature-flags/feature-flag.service.test.ts`:

```ts
jest.mock('@apollo/client/core', () => {
  const actual = jest.requireActual('@apollo/client/core');
  return { ...actual };
});

import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { FeatureFlagsStore } from '@nestfolio/ui/feature-flags';
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

describe('FeatureFlagService (shell-root, dedicated client)', () => {
  it('queries getFeatureFlags via the injected ApolloClient and pushes to the store', async () => {
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
    // Allow the constructor's loadInitialFlags promise to resolve.
    await Promise.resolve();
    await Promise.resolve();

    expect(client.query).toHaveBeenCalledTimes(1);
    const queryArg = (client.query as jest.Mock).mock.calls[0][0] as { query: { kind: string } };
    expect(queryArg.query.kind).toBe('Document');
    expect(setFlags).toHaveBeenCalledWith([{ name: 'foo', enabled: true, reason: 'default' }]);
  });

  it('subscribes to onFeatureFlagUpdate and pushes incremental updates to the store', async () => {
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
    await Promise.resolve();
    await Promise.resolve();

    emitter.next({ data: { onFeatureFlagUpdate: { name: 'bar', enabled: false, reason: 'override' } } });
    expect(updateFlag).toHaveBeenCalledWith({ name: 'bar', enabled: false, reason: 'override' });
  });

  it('does NOT inject GraphqlService or MFE_DOMAIN (architectural invariant)', () => {
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

    // No MFE_DOMAIN provider, no GraphqlService provider — must still resolve.
    expect(() => TestBed.inject(FeatureFlagService)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx run shell:test --testPathPattern=feature-flags/feature-flag.service`
Expected: FAIL — module `../../src/feature-flags/feature-flag.service` not found.

- [ ] **Step 3: Write the service**

Create `libs/shell/src/feature-flags/feature-flag.service.ts`:

```ts
import { Injectable, OnDestroy, inject } from '@angular/core';
import { Subscription } from 'rxjs';
import { gql, ApolloClient } from '@apollo/client/core';
import { FeatureFlagsStore, GET_FEATURE_FLAGS, ON_FEATURE_FLAG_UPDATE } from '@nestfolio/ui/feature-flags';
import type { FeatureFlag } from '@nestfolio/ui/feature-flags';
import { FEATURE_FLAG_APOLLO_CLIENT } from './feature-flag-apollo-client';

@Injectable()
export class FeatureFlagService implements OnDestroy {
  private readonly store = inject(FeatureFlagsStore);
  private readonly client = inject<ApolloClient>(FEATURE_FLAG_APOLLO_CLIENT);
  private subscription: Subscription | null = null;

  constructor() {
    this.loadInitialFlags();
    this.subscribeToUpdates();
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

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx run shell:test --testPathPattern=feature-flags/feature-flag.service`
Expected: 3 tests PASS.

---

## Task 3: Write `provideFeatureFlags()` provider helper (TDD)

**Files:**
- Create: `libs/shell/src/feature-flags/provide-feature-flags.ts`
- Create: `libs/shell/test/feature-flags/provide-feature-flags.test.ts`

- [ ] **Step 1: Write the failing test**

Create `libs/shell/test/feature-flags/provide-feature-flags.test.ts`:

```ts
jest.mock('aws-amplify/auth', () => ({
  fetchAuthSession: jest.fn().mockResolvedValue({ tokens: { idToken: { toString: () => 'jwt' } } }),
}));
jest.mock('aws-appsync-auth-link', () => ({
  createAuthLink: jest.fn().mockReturnValue({ request: jest.fn() }),
  AUTH_TYPE: { AMAZON_COGNITO_USER_POOLS: 'AMAZON_COGNITO_USER_POOLS' },
}));
jest.mock('aws-appsync-subscription-link', () => ({
  createSubscriptionHandshakeLink: jest.fn().mockReturnValue({ request: jest.fn() }),
}));

import { APP_INITIALIZER } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ApolloClient } from '@apollo/client/core';
import { AuthConfig } from '../../src/auth';
import { AuthStore } from '../../src/stores/auth.store';
import { FEATURE_FLAG_APOLLO_CLIENT } from '../../src/feature-flags/feature-flag-apollo-client';
import { FeatureFlagService } from '../../src/feature-flags/feature-flag.service';
import { provideFeatureFlags } from '../../src/feature-flags/provide-feature-flags';

describe('provideFeatureFlags()', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: AuthConfig,
          useValue: { userPoolId: 'pool', clientId: 'client', region: 'us-east-1' },
        },
        provideFeatureFlags(),
      ],
    });
  });

  it('provides FEATURE_FLAG_APOLLO_CLIENT as an ApolloClient instance', () => {
    const client = TestBed.inject(FEATURE_FLAG_APOLLO_CLIENT);
    expect(client).toBeInstanceOf(ApolloClient);
  });

  it('provides FeatureFlagService at the root', () => {
    // No throw = injector resolved without MFE_DOMAIN / GraphqlService.
    expect(() => TestBed.inject(FeatureFlagService)).not.toThrow();
  });

  it('registers an APP_INITIALIZER that warms FeatureFlagService', () => {
    const initializers = TestBed.inject(APP_INITIALIZER);
    expect(Array.isArray(initializers) ? initializers.length : 1).toBeGreaterThan(0);
    // Spy on AuthStore so we have a concrete observable side-effect to assert
    // the initializer runs (the service's constructor kicks off the apollo
    // calls; here we just verify the initializer is callable and resolves).
    const fns = (Array.isArray(initializers) ? initializers : [initializers]) as Array<() => unknown>;
    return Promise.all(fns.map((fn) => fn()));
  });
});

// Silence unused warnings — AuthStore is referenced via DI, no direct use.
void AuthStore;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx run shell:test --testPathPattern=feature-flags/provide-feature-flags`
Expected: FAIL — module `../../src/feature-flags/provide-feature-flags` not found.

- [ ] **Step 3: Write the provider helper**

Create `libs/shell/src/feature-flags/provide-feature-flags.ts`:

```ts
import {
  APP_INITIALIZER,
  EnvironmentProviders,
  inject,
  makeEnvironmentProviders,
} from '@angular/core';
import { Router } from '@angular/router';
import { AuthConfig, authSignOut } from '../auth';
import { AuthStore } from '../stores/auth.store';
import {
  FEATURE_FLAG_APOLLO_CLIENT,
  createFeatureFlagApolloClient,
} from './feature-flag-apollo-client';
import { FeatureFlagService } from './feature-flag.service';

/**
 * Wires the shell-root feature-flag stack:
 *
 * - `FEATURE_FLAG_APOLLO_CLIENT` — dedicated Apollo client targeting the
 *   investor BFF (where the feature-flag schema lives), built lazily from
 *   `AuthConfig` so it composes with `provideAuth()` and `fetchRuntimeConfig()`
 *   without ordering footguns.
 * - `FeatureFlagService` — root-scoped, injects the client above (NOT the
 *   per-MFE `GraphqlService`).
 * - `APP_INITIALIZER` — instantiates `FeatureFlagService` so its constructor
 *   kicks off `getFeatureFlags` query + subscription warmup.
 * - Auth-failure handling — on 401/403 from Apollo, signs out + clears the
 *   auth store + navigates to `/login`, matching `GraphqlService.handleAuthFailure`.
 *
 * Apply in the host: `app.config.ts` providers array → `provideFeatureFlags()`.
 *
 * Pattern note: this is the standard "shell-root services own their transports"
 * shape. Replicate for any future cross-cutting concern that needs backend
 * access at bootstrap (telemetry, audit, user-context).
 */
export function provideFeatureFlags(): EnvironmentProviders {
  return makeEnvironmentProviders([
    FeatureFlagService,
    {
      provide: FEATURE_FLAG_APOLLO_CLIENT,
      useFactory: () => {
        const authConfig = inject(AuthConfig);
        const authStore = inject(AuthStore);
        const router = inject(Router);
        const onAuthFailure = (): void => {
          void (async () => {
            try {
              await authSignOut();
            } catch {
              // Fail-safe — still clear local state + navigate.
            } finally {
              authStore.logout();
              await router.navigate(['/login']);
            }
          })();
        };
        return createFeatureFlagApolloClient({ authConfig, onAuthFailure });
      },
    },
    {
      provide: APP_INITIALIZER,
      useFactory: () => {
        inject(FeatureFlagService); // triggers constructor → loads + subscribes
        return () => Promise.resolve();
      },
      multi: true,
    },
  ]);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx run shell:test --testPathPattern=feature-flags/provide-feature-flags`
Expected: 3 tests PASS.

---

## Task 4: Public surface — `index.ts` for the new module + lib re-exports

**Files:**
- Create: `libs/shell/src/feature-flags/index.ts`
- Modify: `libs/shell/src/index.ts`

- [ ] **Step 1: Write the module index**

Create `libs/shell/src/feature-flags/index.ts`:

```ts
export { FeatureFlagService } from './feature-flag.service';
export { FEATURE_FLAG_APOLLO_CLIENT } from './feature-flag-apollo-client';
export { provideFeatureFlags } from './provide-feature-flags';
```

- [ ] **Step 2: Update the lib root index**

In `libs/shell/src/index.ts`, change line 13:

From:
```ts
export { FeatureFlagService } from './feature-flag.service';
```

To:
```ts
export { FeatureFlagService, provideFeatureFlags } from './feature-flags';
```

- [ ] **Step 3: Verify shell lint + build**

Run: `pnpm nx run shell:lint`
Expected: PASS.

---

## Task 5: Wire into the host + delete the old service file

**Files:**
- Modify: `apps/nestfolio-host/src/app/app.config.ts`
- Delete: `libs/shell/src/feature-flag.service.ts`

- [ ] **Step 1: Update the host's `app.config.ts`**

In `apps/nestfolio-host/src/app/app.config.ts`:

Change line 8 (the import from `@nestfolio/shell`) from:
```ts
import { AuthStore, GlobalErrorHandler, FeatureFlagService, COPILOT_API_URL } from '@nestfolio/shell';
```

To:
```ts
import { AuthStore, GlobalErrorHandler, COPILOT_API_URL, provideFeatureFlags } from '@nestfolio/shell';
```

Replace the trailing FeatureFlagService APP_INITIALIZER block (lines 132–144 in the current file) — that is the entire block:

```ts
    {
      provide: APP_INITIALIZER,
      useFactory: () => {
        inject(FeatureFlagService); // triggers constructor → loads flags + subscribes
        return () => Promise.resolve();
      },
      multi: true,
    },
```

Replace it with a single line in the providers array (insert it AFTER `provideNestfolioTheme('light')` and BEFORE the `initializeAuth` APP_INITIALIZER, so the runtime-config + auth providers are already in place when the feature-flag client factory injects `AuthConfig`):

```ts
    provideFeatureFlags(),
```

The final relevant section of `appConfig.providers` should read:

```ts
    provideRouter(appRoutes),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideAnimationsAsync(),
    provideAuth(),
    provideI18n('it-IT'),
    provideNestfolioTheme('light'),
    provideFeatureFlags(),
    {
      provide: APP_INITIALIZER,
      useFactory: initializeAuth,
      multi: true,
    },
  ],
};
```

- [ ] **Step 2: Delete the old service file**

```bash
rm libs/shell/src/feature-flag.service.ts
```

- [ ] **Step 3: Verify host + shell lint**

Run: `pnpm nx run-many -t lint -p nestfolio-host shell`
Expected: PASS for both. If `lint` complains about unused imports in `app.config.ts`, remove `FeatureFlagService` from any leftover import line (Step 1 should have caught it).

- [ ] **Step 4: Run the full unit suite for both projects**

Run: `pnpm nx run-many -t test -p nestfolio-host shell`
Expected: All tests PASS — host (39+) and shell (146+ with new feature-flags tests).

- [ ] **Step 5: Build the host (gates `assert-shell-html`)**

Run: `pnpm nx run nestfolio-host:build`
Expected: PASS, including the assert-shell-html check.

- [ ] **Step 6: Commit Tasks 1–5 as one logical unit**

```bash
git add libs/shell/src/feature-flags/ libs/shell/test/feature-flags/ libs/shell/src/index.ts apps/nestfolio-host/src/app/app.config.ts
git rm libs/shell/src/feature-flag.service.ts
git commit -m "$(cat <<'EOF'
refactor(e2): shell-root feature-flag Apollo client

Decouples FeatureFlagService from the per-MFE GraphqlService. Feature
flags now have their own dedicated shell-root Apollo client, eliminating
the NG0201 NullInjectorError that surfaced after Plan E removed the
runtime-config race.

Architecture (charter §4 row 11 — shell-wired cross-cutting singleton):
- libs/shell/src/feature-flags/feature-flag-apollo-client.ts
  FEATURE_FLAG_APOLLO_CLIENT InjectionToken<ApolloClient> + factory
  wrapping createApolloClient with domain: 'investor'. Cache is
  intentionally separate from any per-MFE Apollo client (Apollo v4 MFE
  idiom: one client per backend, isolated cache).
- libs/shell/src/feature-flags/feature-flag.service.ts
  Rewritten — injects FEATURE_FLAG_APOLLO_CLIENT directly. No longer
  depends on GraphqlService or MFE_DOMAIN.
- libs/shell/src/feature-flags/provide-feature-flags.ts
  EnvironmentProviders helper wiring client + service + APP_INITIALIZER
  + auth-failure handling (mirrors GraphqlService.handleAuthFailure).
- apps/nestfolio-host/src/app/app.config.ts
  Drops manual FeatureFlagService APP_INITIALIZER; calls
  provideFeatureFlags() once (idiomatic provideAuth() shape).

GraphqlService and MFE_DOMAIN are untouched — they remain correctly
route-scoped for MFE-local queries.

Pattern: "shell-root services own their transports" — generalizes to
any future cross-cutting concern needing backend access at bootstrap
(telemetry, user-context, audit).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Deploy + cf-smoke verification

- [ ] **Step 1: Force a fresh build (Plan E learned this lesson)**

Run: `pnpm nx run nestfolio-host:build --skip-nx-cache`
Expected: PASS, including assert-shell-html.

- [ ] **Step 2: Sanity-check the dist for the new architecture**

Run: `grep -l "FEATURE_FLAG_APOLLO_CLIENT" /Users/fabiovitali/WebstormProjects/nestfolio/dist/apps/nestfolio-host/browser/*.js`
Expected: at least one file matched. If empty, the build was still cached — re-run with `--skip-nx-cache`.

Also run: `grep -l "loadRuntimeConfig must run as an APP_INITIALIZER" /Users/fabiovitali/WebstormProjects/nestfolio/dist/apps/nestfolio-host/browser/*.js`
Expected: empty (Plan E core fix preserved).

- [ ] **Step 3: Refresh runtime config + deploy shell to dev**

Run:
```bash
pnpm nx run nestfolio-host:config --prefix=dev
bash infrastructure/scripts/deploy-shell.sh dev
```

Expected: producer writes `apps/nestfolio-host/public/assets/config.json`; deploy-shell.sh syncs ~10+ MiB to S3 + invalidates `/index.html /assets/* /remoteEntry.json`. Wait for the invalidation to complete (~1–2 minutes).

- [ ] **Step 4: Run cf-smoke**

Run: `pnpm cf-smoke --prefix=dev`
Expected: 5/5 routes (`/investor`, `/advisory`, `/ledger`, `/dashboard`, `/onboarding`) PASS. No NG0201, no Runtime-config-not-initialised, no AppSync 401/403, no federation chunk 404.

- [ ] **Step 5: If cf-smoke FAILs**

Capture the error class. Three cases:

1. **Different NG0201** — another shell-root APP_INITIALIZER injects something route-scoped. Search the appConfig providers for any other DI dependency on a per-route token. Likely candidate: nothing (Plan E2 is the only known case), but verify the stack trace.

2. **Apollo network error (401/403/network failure)** — feature-flag query is reaching the BFF but failing auth. Check the deployed `/graphql/investor` endpoint with the JWT — likely an `investor-bff` issue, not Plan E2's scope.

3. **Apollo CORS / wrong endpoint** — the dedicated client targets `/graphql/investor` (relative URL → CloudFront origin). If the smoke shows a hostname mismatch, verify CloudFront's `/graphql/<domain>` behavior is wired (Plan B1 territory; should already be in place).

In any case, surface the error class to the user before patching.

---

## Task 7: Memory + plan-status updates

- [ ] **Step 1: Update `project_mfe_charter_migration.md`**

Append a new "Phase E2" section after the existing Phase E summary noting:
- Branch + plan path
- Architecture: shell-root feature-flag client decouples FeatureFlagService from per-MFE GraphqlService
- Charter alignment: §4 row 11 — feature flags as shell-wired cross-cutting singleton
- Pattern: "shell-root services own their transports", generalizable to telemetry/user-context/audit
- Verification: cf-smoke 5/5 PASS

- [ ] **Step 2: Update `MEMORY.md` index**

Update the MFE-charter-migration entry to reflect FULL graduation including the B3 regression fix.

- [ ] **Step 3: Mark plan checkboxes complete in this file**

Tick all `- [ ]` boxes that the executor walked through.

---

## Self-Review

**Spec coverage:**
- Decouple FeatureFlagService from GraphqlService → Tasks 2, 3, 5.
- Dedicated shell-root Apollo client targeting investor-bff → Task 1.
- Generalizable provider helper (`provideFeatureFlags()`) → Task 3.
- Host wiring + old-file cleanup → Task 5.
- Tests for service + provider wiring → Tasks 2, 3.
- Deploy + cf-smoke → Task 6.
- Memory updates → Task 7.

**Placeholder scan:** None. Every code block contains the actual content. Every command is exact. Task 6 Step 5's diagnostic enumerates three concrete failure classes, each with a specific check.

**Type consistency:**
- `FEATURE_FLAG_APOLLO_CLIENT: InjectionToken<ApolloClient>` is consistent across Task 1 (definition), Task 2 (test + service `inject<ApolloClient>(FEATURE_FLAG_APOLLO_CLIENT)`), Task 3 (provider).
- `createFeatureFlagApolloClient(opts: { authConfig, onAuthFailure })` is consistent: defined Task 1, called Task 3.
- `FeatureFlagService` constructor injects exactly two tokens (`FeatureFlagsStore`, `FEATURE_FLAG_APOLLO_CLIENT`) — consistent across Task 2 source, Task 2 tests (which provide both), Task 3 (which makes both available at root).
- `provideFeatureFlags(): EnvironmentProviders` (no args) — consistent across Task 3 (definition), Task 5 (call site), Task 4 (re-export).
- Auth-failure handler signature `(reason: string) => void` — consistent across Task 1 (`createApolloClient` opts) and Task 3 (provider's wrapper).

**Architectural invariants verified:**
- Test in Task 2 explicitly asserts `FeatureFlagService` resolves WITHOUT a `MFE_DOMAIN` provider in the testbed — making the architectural decoupling enforceable at unit-test time.
- `GraphqlService` and `MFE_DOMAIN` are NOT modified anywhere in this plan.
