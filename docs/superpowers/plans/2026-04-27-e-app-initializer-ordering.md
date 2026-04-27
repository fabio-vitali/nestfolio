# Plan E: Hoist Runtime Config Fetch Before bootstrapApplication

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the Angular APP_INITIALIZER ordering race that breaks deployed-CloudFront shell render by loading `/assets/config.json` BEFORE `bootstrapApplication()` runs — so every consuming factory sees a populated runtime config regardless of DI hydration order.

**Architecture:** The shell's `bootstrap.ts` is dynamically imported by `main.ts` AFTER `initFederation()` resolves. We add an `await fetchRuntimeConfig()` step at the top of `bootstrap.ts` (top-level await in an ESM module is supported in modern bundlers + esbuild). This populates the module-scoped `runtimeConfig` in `app.config.ts` synchronously by the time `bootstrapApplication()` triggers DI hydration. The `loadRuntimeConfig` APP_INITIALIZER and the `awaitRuntimeConfigReady` defer-callback wiring become dead code and are deleted. `libs/shell/src/auth/auth.provider.ts` reverts to the pre-Plan-E synchronous shape (`inject(AuthConfig)` at factory time) since the race no longer exists.

**Tech Stack:** Angular 21 standalone-component bootstrap, Native Federation (esbuild), TypeScript, Jest unit tests, Playwright cf-smoke probe.

**Branch:** Continue on `feat/e-app-initializer-ordering` (1 partial-fix commit `154e8b91` already there).

---

## Background

cf-smoke iter-9 (after Plan D graduation) FAILs deployed-dev with:

```
Error: Runtime config not initialised. loadRuntimeConfig must run as an
APP_INITIALIZER before any consumer reads getRuntimeConfig().
```

Stack trace shows a different outer factory than the one fixed in `154e8b91` — `chunk-BK2YLYQV.js:1:6571`. Patching per-factory is whack-a-mole; the architectural fix is to take `loadRuntimeConfig` out of the APP_INITIALIZER chain entirely.

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `apps/nestfolio-host/src/app/app.config.ts` | Runtime config module-state + AuthConfig/COPILOT_API_URL providers | **Modify** — replace `loadRuntimeConfig()` APP_INITIALIZER factory with async `fetchRuntimeConfig()`; delete `awaitRuntimeConfigReady`; drop `loadRuntimeConfig` APP_INITIALIZER provider; call `provideAuth()` with no args |
| `apps/nestfolio-host/src/bootstrap.ts` | Bootstrap entry point (dynamically imported by main.ts) | **Modify** — add top-level `await fetchRuntimeConfig()` before `bootstrapApplication()` |
| `libs/shell/src/auth/auth.provider.ts` | Amplify configuration as APP_INITIALIZER | **Modify** — revert to pre-Plan-E shape: no `awaitConfig` param, synchronous `inject(AuthConfig)` at factory time |
| `apps/nestfolio-host/test/app/app.config.spec.ts` | Unit tests for app.config | **Modify** — switch from `loadRuntimeConfig()()` to `fetchRuntimeConfig()`; tests asserting bootstrap-time fail-hard behavior preserved |
| `libs/shell/test/auth/auth.provider.spec.ts` | Unit tests for provideAuth | **Modify** — restore pre-Plan-E test shape; the deferred-injection assertion becomes obsolete |
| `apps/nestfolio-host/src/app/runtime-config.service.ts` | Doc comment | **Modify** — update doc to say config is loaded before bootstrap, not via APP_INITIALIZER |
| `apps/nestfolio-host/src/main.ts` | Federation init | **No change** — federation must still init first; bootstrap.ts dynamic import happens after |

---

## Task 1: Refactor `app.config.ts` — extract `fetchRuntimeConfig` and delete APP_INITIALIZER wiring

**Files:**
- Modify: `apps/nestfolio-host/src/app/app.config.ts`

- [ ] **Step 1: Update `app.config.ts` end-to-end**

Replace the entire file with the following content:

```ts
import { ApplicationConfig, provideZonelessChangeDetection, APP_INITIALIZER, ErrorHandler, isDevMode, inject } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideAuth, authInterceptor, getAuthUser, AuthConfig } from '@nestfolio/shell/auth';
import { provideI18n } from '@nestfolio/shell/i18n';
import { provideNestfolioTheme } from '@nestfolio/ui';
import { AuthStore, GlobalErrorHandler, FeatureFlagService, COPILOT_API_URL } from '@nestfolio/shell';
import { appRoutes } from './app.routes';

export interface RuntimeConfig {
  auth: { userPoolId: string; clientId: string; region: string };
  copilotApiUrl: string;
}

let runtimeConfig: RuntimeConfig | null = null;

export function getRuntimeConfig(): RuntimeConfig {
  if (!runtimeConfig) {
    throw new Error(
      'Runtime config not initialised. fetchRuntimeConfig() must run before bootstrapApplication().',
    );
  }
  return runtimeConfig;
}

export function validateEndpoints(config: RuntimeConfig): void {
  const url = config.copilotApiUrl;
  if (!url) return;
  if (url.startsWith('https://')) return;
  if (isDevMode() && url.startsWith('http://localhost')) return;
  throw new Error(`Invalid endpoint URL: "${url}". All endpoints must use HTTPS.`);
}

/**
 * Fetches `/assets/config.json` and populates the module-scoped
 * `runtimeConfig` so any DI factory that calls `getRuntimeConfig()` during
 * Angular bootstrap finds a populated value. Must be awaited BEFORE
 * `bootstrapApplication()` in `bootstrap.ts`.
 *
 * Fail-hard: every failure mode (404, malformed JSON, validation reject,
 * network error) throws with a named-path remediation.
 */
export async function fetchRuntimeConfig(): Promise<RuntimeConfig> {
  const remediation =
    'Run `pnpm nx run nestfolio-host:config --prefix=<prefix>` (e.g. --prefix=dev for local development).';
  let response: Response;
  try {
    response = await fetch('/assets/config.json');
  } catch (error) {
    throw new Error(
      `Runtime config not reachable at /assets/config.json: ${String(error)}. ${remediation}`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `Runtime config not found at /assets/config.json (HTTP ${response.status}). ${remediation}`,
    );
  }
  let parsed: RuntimeConfig;
  try {
    parsed = (await response.json()) as RuntimeConfig;
  } catch (error) {
    throw new Error(
      `Runtime config malformed at /assets/config.json: ${String(error)}. Re-run \`pnpm nx run nestfolio-host:config --prefix=<prefix>\`.`,
    );
  }
  validateEndpoints(parsed);
  runtimeConfig = parsed;
  return parsed;
}

function initializeAuth(): () => Promise<void> {
  const authStore = inject(AuthStore);
  return async () => {
    const user = await getAuthUser();
    if (user) {
      authStore.setAuthenticated({
        userId: user.userId,
        username: user.username,
        email: user.email ?? '',
        tenantId: user.tenantId ?? '',
        onboardingCompletedAt: user.onboardingCompletedAt ?? null,
      });
    } else {
      authStore.setUnauthenticated();
    }
  };
}

export const appConfig: ApplicationConfig = {
  providers: [
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    provideZonelessChangeDetection(),
    {
      provide: AuthConfig,
      useFactory: () => getRuntimeConfig().auth,
    },
    {
      provide: COPILOT_API_URL,
      useFactory: () => getRuntimeConfig().copilotApiUrl,
    },
    provideRouter(appRoutes),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideAnimationsAsync(),
    provideAuth(),
    provideI18n('it-IT'),
    provideNestfolioTheme('light'),
    {
      provide: APP_INITIALIZER,
      useFactory: initializeAuth,
      multi: true,
    },
    {
      provide: APP_INITIALIZER,
      useFactory: () => {
        inject(FeatureFlagService); // triggers constructor → loads flags + subscribes
        return () => Promise.resolve();
      },
      multi: true,
    },
  ],
};
```

Diff summary vs current file:
- Removed: `runtimeConfigPromise` global, `awaitRuntimeConfigReady` export, `loadRuntimeConfig` factory, the `loadRuntimeConfig` APP_INITIALIZER provider entry.
- Added: `fetchRuntimeConfig()` async function (the body of the old factory's IIFE, lifted to a top-level export).
- Changed: `getRuntimeConfig()` throw message updated to reflect new ordering (mentions `bootstrap.ts`, not APP_INITIALIZER).
- Changed: `provideAuth(awaitRuntimeConfigReady)` → `provideAuth()`.
- Unchanged: `validateEndpoints`, `AuthConfig` + `COPILOT_API_URL` `useFactory` providers, `initializeAuth`, `FeatureFlagService` APP_INITIALIZER, all other providers.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm nx run nestfolio-host:lint`
Expected: PASS (no missing-export / unused-import errors). If `inject` is no longer used at the top of the file due to provider changes, leave it — `initializeAuth` and the `FeatureFlagService` APP_INITIALIZER both call `inject()`.

- [ ] **Step 3: Commit**

```bash
git add apps/nestfolio-host/src/app/app.config.ts
git commit -m "$(cat <<'EOF'
refactor(e): extract fetchRuntimeConfig, drop APP_INITIALIZER race

- replace loadRuntimeConfig() APP_INITIALIZER factory with async
  fetchRuntimeConfig() — caller awaits it BEFORE bootstrapApplication
- delete awaitRuntimeConfigReady + runtimeConfigPromise globals
- drop loadRuntimeConfig APP_INITIALIZER provider
- call provideAuth() with no awaitConfig arg

Sets up Task 2 (bootstrap.ts) to actually run fetchRuntimeConfig at
the right point. Tests + provideAuth shape come in Tasks 3-5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Hoist `fetchRuntimeConfig()` into `bootstrap.ts`

**Files:**
- Modify: `apps/nestfolio-host/src/bootstrap.ts`

- [ ] **Step 1: Replace `bootstrap.ts` content**

Replace the file with:

```ts
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig, fetchRuntimeConfig } from './app/app.config';

await fetchRuntimeConfig();

// eslint-disable-next-line no-console
bootstrapApplication(AppComponent, appConfig).catch(err => console.error(err));
```

Why top-level await is safe here: `bootstrap.ts` is loaded via `import('./bootstrap')` in `main.ts` (a dynamic import that already returns a Promise). esbuild and Angular's Native Federation builder both support top-level await in ESM module chunks. If the build fails on this construct, fall back to wrapping in an IIFE:

```ts
(async () => {
  await fetchRuntimeConfig();
  // eslint-disable-next-line no-console
  bootstrapApplication(AppComponent, appConfig).catch(err => console.error(err));
})();
```

- [ ] **Step 2: Build to verify the change compiles**

Run: `pnpm nx run nestfolio-host:build`
Expected: PASS. If you see `Top-level 'await' expressions are only allowed when the 'module' option is set to ...` or similar, switch to the IIFE form above and rebuild.

- [ ] **Step 3: Commit**

```bash
git add apps/nestfolio-host/src/bootstrap.ts
git commit -m "$(cat <<'EOF'
fix(e): await fetchRuntimeConfig before bootstrapApplication

Eliminates the APP_INITIALIZER ordering race entirely — every DI
factory that reads getRuntimeConfig() during Angular hydration now
sees a populated config, regardless of factory-resolution order.

This is the architectural fix for the cf-smoke iter-9 failure that
the partial fix in 154e8b91 only papered over for one factory.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Revert `auth.provider.ts` to pre-Plan-E shape

**Files:**
- Modify: `libs/shell/src/auth/auth.provider.ts`

- [ ] **Step 1: Replace file with simpler synchronous shape**

Overwrite `libs/shell/src/auth/auth.provider.ts` with:

```ts
import { type EnvironmentProviders, makeEnvironmentProviders, APP_INITIALIZER, inject } from '@angular/core';
import { Amplify } from 'aws-amplify';
import { AuthConfig } from './auth.config';

/**
 * Registers the Amplify configuration step as an APP_INITIALIZER.
 * Reads `AuthConfig` from DI at injection time — the value must be provided
 * by the consuming app via `{ provide: AuthConfig, useFactory: () => ... }`.
 *
 * Bootstrap ordering: this initializer must run AFTER the runtime-config
 * loader has populated the source the AuthConfig factory reads from.
 * The shell host (`apps/nestfolio-host`) ensures this by awaiting
 * `fetchRuntimeConfig()` BEFORE `bootstrapApplication()` in `bootstrap.ts`.
 */
export function provideAuth(): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: APP_INITIALIZER,
      useFactory: () => {
        const cfg = inject(AuthConfig);
        return () => {
          Amplify.configure({
            Auth: {
              Cognito: {
                userPoolId: cfg.userPoolId,
                userPoolClientId: cfg.clientId,
              },
            },
          });
        };
      },
      multi: true,
    },
  ]);
}
```

Diff vs current file:
- Removed: `awaitConfig?: () => Promise<unknown>` parameter, `Injector` import + capture, async wrapping of the initializer body, the multi-paragraph "why deferred" doc.
- Added: shorter doc that points at the host's `bootstrap.ts` ordering guarantee.

- [ ] **Step 2: Lint shell lib**

Run: `pnpm nx run shell:lint`
Expected: PASS (`Injector` import was the only addition from 154e8b91 and is now gone).

- [ ] **Step 3: Commit**

```bash
git add libs/shell/src/auth/auth.provider.ts
git commit -m "$(cat <<'EOF'
refactor(e): revert provideAuth to synchronous inject(AuthConfig)

The defensive Injector + lazy injector.get(AuthConfig) pattern from
154e8b91 was needed because loadRuntimeConfig was an APP_INITIALIZER
sibling. Now that the host awaits fetchRuntimeConfig BEFORE
bootstrapApplication (Task 2), AuthConfig.useFactory always finds a
populated runtimeConfig at DI hydration time — sync inject is safe
again.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Update `app.config.spec.ts` for the new export shape

**Files:**
- Modify: `apps/nestfolio-host/test/app/app.config.spec.ts`

- [ ] **Step 1: Update import line**

In `apps/nestfolio-host/test/app/app.config.spec.ts`, change line 26:

From:
```ts
import { validateEndpoints, RuntimeConfig, loadRuntimeConfig, getRuntimeConfig } from '../../src/app/app.config';
```

To:
```ts
import { validateEndpoints, RuntimeConfig, fetchRuntimeConfig, getRuntimeConfig } from '../../src/app/app.config';
```

- [ ] **Step 2: Replace the whole `loadRuntimeConfig (fail-hard)` describe block**

Replace lines 74-116 (the `describe('loadRuntimeConfig (fail-hard)', ...)` block) with:

```ts
describe('fetchRuntimeConfig (fail-hard)', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => { devMode = false; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('populates runtimeConfig on a successful fetch', async () => {
    const cfg = makeConfig();
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => cfg,
    } as unknown as Response);
    await fetchRuntimeConfig();
    expect(getRuntimeConfig()).toEqual(cfg);
  });

  it('throws with named remediation on HTTP 404', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false, status: 404, json: async () => ({}),
    } as unknown as Response);
    await expect(fetchRuntimeConfig()).rejects.toThrow(
      /Runtime config not found.*nestfolio-host:config/,
    );
  });

  it('throws on malformed JSON', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); },
    } as unknown as Response);
    await expect(fetchRuntimeConfig()).rejects.toThrow(/Runtime config malformed/);
  });

  it('throws when validateEndpoints rejects', async () => {
    const bad = makeConfig({ copilotApiUrl: 'http://evil.com/api/copilotkit' });
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => bad,
    } as unknown as Response);
    await expect(fetchRuntimeConfig()).rejects.toThrow('Invalid endpoint URL');
  });

  it('throws on network error', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new TypeError('NetworkError'));
    await expect(fetchRuntimeConfig()).rejects.toThrow(/Runtime config not reachable/);
  });
});
```

Diff: every `loadRuntimeConfig()()` call becomes `fetchRuntimeConfig()`; describe label updated; otherwise identical.

- [ ] **Step 2a: Add a focused test that asserts `getRuntimeConfig()` throw-message matches the new bootstrap-ordering wording**

Append to the same file (after the `fetchRuntimeConfig (fail-hard)` describe):

```ts
describe('getRuntimeConfig() guard', () => {
  it('throws with bootstrap-ordering remediation when runtimeConfig is not yet populated', () => {
    // Force a fresh module state by re-importing through jest.isolateModules.
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fresh = require('../../src/app/app.config') as typeof import('../../src/app/app.config');
      expect(() => fresh.getRuntimeConfig()).toThrow(
        /fetchRuntimeConfig\(\) must run before bootstrapApplication/,
      );
    });
  });
});
```

- [ ] **Step 3: Run the suite**

Run: `pnpm nx run nestfolio-host:test --testPathPattern=app.config.spec`
Expected: All `validateEndpoints` (6), `fetchRuntimeConfig (fail-hard)` (5), and `getRuntimeConfig() guard` (1) tests PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/nestfolio-host/test/app/app.config.spec.ts
git commit -m "$(cat <<'EOF'
test(e): update app.config tests for fetchRuntimeConfig export

Switch all loadRuntimeConfig()() invocations to fetchRuntimeConfig().
Add a focused guard test for getRuntimeConfig()'s new throw message
mentioning the bootstrap-ordering invariant.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Update `auth.provider.spec.ts` for the synchronous shape

**Files:**
- Modify: `libs/shell/test/auth/auth.provider.spec.ts`

- [ ] **Step 1: Replace second test (deferred-injection assertion)**

The second test asserts the factory deferred reading AuthConfig — that behavior is gone. Replace the whole file with:

```ts
jest.mock('aws-amplify', () => ({
  Amplify: { configure: jest.fn() },
}));

import { APP_INITIALIZER } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Amplify } from 'aws-amplify';
import { AuthConfig } from '../../src/auth/auth.config';
import { provideAuth } from '../../src/auth/auth.provider';

describe('provideAuth()', () => {
  beforeEach(() => {
    (Amplify.configure as jest.Mock).mockClear();
  });

  it('configures Amplify with values resolved via inject(AuthConfig)', async () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AuthConfig,
          useFactory: () => ({
            userPoolId: 'pool-from-factory',
            clientId: 'client-from-factory',
            region: 'us-east-1',
          }),
        },
        provideAuth(),
      ],
    });

    const initializers = TestBed.inject(APP_INITIALIZER);
    const initFns = (Array.isArray(initializers) ? initializers : [initializers])
      .map((fn: () => unknown) => fn());
    await Promise.all(initFns);

    expect(Amplify.configure).toHaveBeenCalledWith({
      Auth: {
        Cognito: {
          userPoolId: 'pool-from-factory',
          userPoolClientId: 'client-from-factory',
        },
      },
    });
  });

  it('reads AuthConfig at APP_INITIALIZER factory-resolution time', () => {
    // The factory captures cfg via inject(AuthConfig) at hydration time.
    // The host (apps/nestfolio-host) guarantees fetchRuntimeConfig has
    // already populated runtimeConfig before bootstrap, so this is safe.
    const factoryCalls: string[] = [];
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AuthConfig,
          useFactory: () => {
            factoryCalls.push('AuthConfig.useFactory');
            return { userPoolId: 'pool', clientId: 'client', region: 'us-east-1' };
          },
        },
        provideAuth(),
      ],
    });

    // Triggering APP_INITIALIZER injection runs the factory, which calls
    // inject(AuthConfig), which runs AuthConfig.useFactory.
    TestBed.inject(APP_INITIALIZER);
    expect(factoryCalls).toContain('AuthConfig.useFactory');
  });
});
```

- [ ] **Step 2: Run the suite**

Run: `pnpm nx run shell:test --testPathPattern=auth.provider`
Expected: 2 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add libs/shell/test/auth/auth.provider.spec.ts
git commit -m "$(cat <<'EOF'
test(e): align auth.provider tests with synchronous shape

The deferred-injection test asserted behavior added in 154e8b91 that
this plan reverts. New second test simply confirms AuthConfig.useFactory
is invoked at APP_INITIALIZER hydration time.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Update doc comment in `runtime-config.service.ts`

**Files:**
- Modify: `apps/nestfolio-host/src/app/runtime-config.service.ts`

- [ ] **Step 1: Edit doc comment**

In `apps/nestfolio-host/src/app/runtime-config.service.ts`, replace lines 4-12 (the JSDoc block) with:

```ts
/**
 * Injectable service that provides access to the runtime configuration.
 * The config is loaded by `fetchRuntimeConfig()` at the top of
 * `bootstrap.ts` BEFORE `bootstrapApplication()` runs, so it is
 * guaranteed to be available by the time any component or service
 * injects this.
 *
 * Values always come from /assets/config.json — produced by
 * `pnpm nx run nestfolio-host:config --prefix=<prefix>`. No environment.ts
 * fallback exists; if the producer hasn't run, bootstrap fails hard.
 */
```

- [ ] **Step 2: Commit**

```bash
git add apps/nestfolio-host/src/app/runtime-config.service.ts
git commit -m "$(cat <<'EOF'
docs(e): runtime-config.service comment reflects pre-bootstrap fetch

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Full-suite verification before deploy

- [ ] **Step 1: Run all touched-project unit tests**

Run: `pnpm nx run-many -t test -p nestfolio-host shell`
Expected: 146 tests PASS (44 nestfolio-host + ~102 shell — exact count may differ ±2 from the new app.config guard test). Zero failures.

- [ ] **Step 2: Run all touched-project lint**

Run: `pnpm nx run-many -t lint -p nestfolio-host shell`
Expected: PASS for both. Pre-existing `any`-warnings in test files are acceptable per Plan B3 final review (15 warnings).

- [ ] **Step 3: Run nestfolio-host build (gates `assert-shell-html` invariants)**

Run: `pnpm nx run nestfolio-host:build`
Expected: PASS. The `assert-shell-html` post-build step inspects the emitted `index.html` for federation invariants (Rules 1–4 after Plan D Rule 5 removal); this Plan E refactor doesn't touch federation surface, so all four pass.

- [ ] **Step 4: Run all 5 MFE builds (sanity — should be unaffected)**

Run: `pnpm nx run-many -t build -p investor-mfe advisory-mfe ledger-mfe dashboard-mfe onboarding-mfe`
Expected: 5/5 PASS.

---

## Task 8: Deploy shell to dev + run cf-smoke

- [ ] **Step 1: Refresh runtime config artifact**

Run: `pnpm nx run nestfolio-host:config --prefix=dev`
Expected: writes `apps/nestfolio-host/public/assets/config.json` with the 4 SSM-sourced values + copilotApiUrl. Exit 0. If exit is non-zero, the producer's named remediation tells you which SSM param is missing — fix that before continuing.

- [ ] **Step 2: Deploy the shell bundle to dev**

Run: `pnpm nx run investor-web:deploy-shell --prefix=dev`
Expected: chains `nestfolio-host:config` (cached, no-op) → `nestfolio-host:build` → `bash infrastructure/scripts/deploy-shell.sh dev` (uploads to shell bucket, swaps in prod manifest, invalidates CloudFront `/index.html`). Wait for the invalidation to complete (`deploy-shell.sh` polls).

- [ ] **Step 3: Run cf-smoke**

Run: `pnpm cf-smoke --prefix=dev`
Expected: 5/5 routes (`/investor`, `/advisory`, `/ledger`, `/dashboard`, `/onboarding`) PASS. Each route asserts: HTTP 200/304 within 10 s + non-empty `<app-root>` + zero `console.error` + zero failed `/graphql/*`/`/mfe/*`/`/realtime/*` requests.

If `/onboarding` fails with a CopilotKit-runtime error, that is OUT OF PLAN E SCOPE (separate `onboarding-bff` AgentCore concern). The other 4 routes must PASS — those are the charter graduation gate.

- [ ] **Step 4: If cf-smoke FAILs**

Capture the full failure output (stdout + the saved screenshot path that cf-smoke prints). Three diagnostic moves before iterating:

1. Open the deployed `https://<distribution>/<route>` URL in Chrome DevTools, snapshot the console error stack frame.
2. If the error is still `Runtime config not initialised`, the network tab will show whether `/assets/config.json` resolved 200 — if 404, the deploy step skipped the file (re-check `deploy-shell.sh` upload manifest).
3. If the error is a *different* class (e.g., AppSync 401, federation chunk 404), that's a different layer; surface to the user before patching.

- [ ] **Step 5: Final commit if any test/build adjustments were needed**

If Steps 1–4 required no further code changes, skip. Otherwise commit per task convention.

---

## Task 9: Update memory after success

- [ ] **Step 1: Append a Plan E success entry to `project_mfe_charter_migration.md`**

Add a new section after the current Phase D summary:

```md
## Phase E — Plan E shipped 2026-04-27

Branch `feat/e-app-initializer-ordering`, N commits. Plan: `docs/superpowers/plans/2026-04-27-e-app-initializer-ordering.md`.

**Architectural fix:** moved `fetchRuntimeConfig()` out of the APP_INITIALIZER chain entirely. `apps/nestfolio-host/src/bootstrap.ts` now `await`s the runtime-config fetch BEFORE `bootstrapApplication()` runs. Every DI factory that calls `getRuntimeConfig()` during Angular hydration sees a populated value, regardless of factory-resolution order.

**Reverted:** `libs/shell/src/auth/auth.provider.ts` back to pre-Plan-E synchronous shape (`inject(AuthConfig)` at factory time). The defensive Injector pattern from `154e8b91` is no longer needed.

**Verification:** cf-smoke 5/5 PASS against deployed dev CloudFront. Charter graduation: COMPLETE.
```

- [ ] **Step 2: Update `MEMORY.md` index**

In `/Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/MEMORY.md`, update the MFE charter entry to read `SUBSTANTIALLY GRADUATED` → `FULLY GRADUATED 2026-04-27` and reference Plan E.

- [ ] **Step 3: Mark this plan's checkboxes complete in this file**

(The executor agent does this naturally as it ticks through.)

---

## Self-Review

**Spec coverage:**
- Hoist runtime-config fetch before `bootstrapApplication` → Tasks 1 + 2.
- Remove `loadRuntimeConfig` APP_INITIALIZER + `awaitRuntimeConfigReady` → Task 1.
- Revert `provideAuth`'s `awaitConfig` plumbing → Task 1 (call site) + Task 3 (signature).
- Update tests → Tasks 4, 5.
- Doc-comment alignment → Task 6.
- Verification → Tasks 7, 8.
- Memory update → Task 9.

**Placeholder scan:** None. Every code block contains the actual content. Every command is exact. The "if cf-smoke fails" diagnostic in Task 8 lists three concrete moves, not "investigate as appropriate".

**Type consistency:**
- `fetchRuntimeConfig(): Promise<RuntimeConfig>` is consistent across Task 1 (definition), Task 2 (`await fetchRuntimeConfig()`), Task 4 (test calls).
- `provideAuth()` signature (no args) is consistent across Task 1 (call site), Task 3 (definition), Task 5 (test).
- `getRuntimeConfig()` throw-message wording (`fetchRuntimeConfig() must run before bootstrapApplication`) is consistent between Task 1's source and Task 4's regex assertion.
