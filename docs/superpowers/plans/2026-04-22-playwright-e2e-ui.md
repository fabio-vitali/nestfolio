# Playwright UI e2e — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up Playwright as a first-class Nx e2e harness exercising a single long "new-investor-happy-path" journey across all MFEs via the real Native-Federation cross-origin load path, without touching `apps/e2e-feature-tests/`.

**Architecture:** New Nx app `apps/nestfolio-e2e/`, per-MFE static servers orchestrated by Playwright's `webServer` array, fresh Cognito tenant per test via `@nestfolio/test-support`, tokens seeded into Amplify's localStorage via `page.addInitScript()`. POMs one-per-MFE, journeys live in `src/journeys/`. UI-only assertions by default; observability exception for the KB interaction step (transitional). CI triggers: path-filter + nightly + on-demand.

**Tech Stack:** Playwright 1.x (Chromium only), Nx 22.5.4, `@nx/web:file-server` (CORS enabled via `cors: true`), `@nestfolio/test-support` (CognitoFixture, SsmCache), Amplify v6 (browser localStorage), AWS SDK v3.

**Guardrails (read before starting):**
- `apps/e2e-feature-tests/` is **untouched**. No deletions, no modifications, no shared-mutation of its helpers. We *import* `freshTenant`/`AgentTraceTrap` via the existing tsconfig alias `@nestfolio/e2e-feature-tests`.
- Prefix everything with `pnpm nx` — never run `playwright` directly at the repo root except in the e2e target's command.
- Tests live in `apps/nestfolio-e2e/src/` (following the spec's directory layout). No `test/` subdirectory — this is a Playwright app, not a library.
- No GraphQL assertions inside `nestfolio-e2e/` specs. If you catch yourself reaching for `bffClient`, the step belongs in `e2e-feature-tests/`.
- Commit frequently — every green task is a commit.

---

## File Structure (end state)

**Created** (all under `apps/nestfolio-e2e/`):
- `playwright.config.ts` — Playwright config with `webServer[]`, projects, reporter, timeouts
- `project.json` — Nx target `e2e` (depends on all six apps' `build`), `e2e-ui`, `lint`
- `tsconfig.json`, `tsconfig.spec.json`, `eslint.config.mjs`
- `src/fixtures/test.ts` — extended `test`/`expect` composing `tenant` + `authedPage`
- `src/fixtures/seed-amplify-tokens.ts` — localStorage seeder + post-seed assertion
- `src/fixtures/enable-deposit-flag.ts` — fixture helper flipping `initiateDeposit`
- `src/pages/onboarding.page.ts` — POM for onboarding-mfe
- `src/pages/dashboard.page.ts` — POM for dashboard-mfe
- `src/pages/investor.page.ts` — POM for investor-mfe (deposit)
- `src/pages/advisory.page.ts` — POM for advisory-mfe (decision detail)
- `src/pages/host.page.ts` — POM for shell-level controls (logout)
- `src/journeys/new-investor-happy-path.spec.ts` — the single journey
- `.github/workflows/nestfolio-e2e.yml` — CI job

**Modified** (existing files):
- `apps/nestfolio-host/public/assets/federation.manifest.json` — P1 fix (add onboarding-mfe)
- `apps/dashboard-mfe/project.json` — P2 fix (serve-static 4201→4202, serve-original same)
- `apps/advisory-mfe/project.json` — P2 fix (serve-static 4202→4203, serve-original same)
- `apps/nestfolio-host/src/environments/environment.ts` — (optional, if option A) set `copilotApiUrl` to deployed CloudFront URL when running under Playwright
- `apps/nestfolio-host/project.json`, 4× `*-mfe/project.json` — enable `cors: true` on all `serve-static` targets
- `apps/onboarding-mfe/src/app/onboarding/onboarding-chat.component.ts` — wire CTA-renderer `clicked` output (step-5 unblock), add `data-testid="renderer-<tool>"` slot marker
- `apps/onboarding-mfe/src/app/onboarding/renderers/*.component.ts` — add `data-testid` attributes to action surfaces
- `libs/test-support/src/ssm-cache.ts` — add `investorWebDistributionUrl()` method
- `libs/test-support/src/index.ts` — (no change needed; SsmCache already re-exported)
- `tsconfig.base.json` — add `@nestfolio/nestfolio-e2e` path if and only if a library-style import emerges (YAGNI: skip unless needed)
- `package.json` (root) — add `@playwright/test` devDependency

**Not touched:**
- `apps/e2e-feature-tests/**`
- `libs/shell/src/components/logout-button.component.ts` (the `data-testid="cta-logout"` is already present — commit `2e2b5c89`)
- `apps/investor-mfe/src/app/deposit/deposit-page.component.ts` (all `data-testid` attributes already present)
- `apps/dashboard-mfe/src/app/dashboard/kpi-cards.component.ts` (`data-testid="cta-deposit"` already present)

---

## Phase 0 — Prerequisites (spec §Pre-work)

**Exit criteria:** `pnpm nx run-many --target=build --projects=nestfolio-host,onboarding-mfe,investor-mfe,dashboard-mfe,advisory-mfe,ledger-mfe` green; `pnpm nx run-many --target=serve-static --parallel=6` binds cleanly to 4200–4205 with no collision; federation manifest includes all five MFEs at the canonical ports; hitting `http://localhost:4200/onboarding` in a browser loads onboarding-mfe (no `MfeErrorComponent`).

### Task 0.1 — P1: Add onboarding-mfe to the federation manifest

**Files:**
- Modify: `apps/nestfolio-host/public/assets/federation.manifest.json`

- [ ] **Step 1: Overwrite the manifest**

Current file contents (verified):
```json
{
  "investor-mfe": "http://localhost:4201/remoteEntry.json",
  "dashboard-mfe": "http://localhost:4202/remoteEntry.json",
  "advisory-mfe": "http://localhost:4203/remoteEntry.json",
  "ledger-mfe": "http://localhost:4204/remoteEntry.json"
}
```

Replace with:
```json
{
  "investor-mfe": "http://localhost:4201/remoteEntry.json",
  "dashboard-mfe": "http://localhost:4202/remoteEntry.json",
  "advisory-mfe": "http://localhost:4203/remoteEntry.json",
  "ledger-mfe": "http://localhost:4204/remoteEntry.json",
  "onboarding-mfe": "http://localhost:4205/remoteEntry.json"
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/nestfolio-host/public/assets/federation.manifest.json
git commit -m "fix(host): add onboarding-mfe to dev federation manifest"
```

### Task 0.2 — P2: Align serve-static ports to the manifest

**Files:**
- Modify: `apps/dashboard-mfe/project.json`
- Modify: `apps/advisory-mfe/project.json`

- [ ] **Step 1: dashboard-mfe serve-static 4201 → 4202**

In `apps/dashboard-mfe/project.json`, change:
```json
    "serve-original": {
      "continuous": true,
      "executor": "@angular-devkit/build-angular:dev-server",
      "options": {
        "port": 4201
      },
```
to
```json
    "serve-original": {
      "continuous": true,
      "executor": "@angular-devkit/build-angular:dev-server",
      "options": {
        "port": 4202
      },
```

And change:
```json
    "serve-static": {
      "continuous": true,
      "executor": "@nx/web:file-server",
      "options": {
        "buildTarget": "dashboard-mfe:build",
        "port": 4201,
        "staticFilePath": "dist/apps/dashboard-mfe/browser",
        "spa": true
      }
    }
```
to
```json
    "serve-static": {
      "continuous": true,
      "executor": "@nx/web:file-server",
      "options": {
        "buildTarget": "dashboard-mfe:build",
        "port": 4202,
        "staticFilePath": "dist/apps/dashboard-mfe/browser",
        "spa": true,
        "cors": true
      }
    }
```

- [ ] **Step 2: advisory-mfe serve-static 4202 → 4203**

In `apps/advisory-mfe/project.json`, change both `serve-original.options.port: 4202 → 4203` and the `serve-static.options` block (same shape as Task 0.2 Step 1): `port: 4202 → 4203` plus add `"cors": true`.

- [ ] **Step 3: Enable CORS on all remaining serve-static targets**

The spec's Plan-level requirement: every MFE's static server must emit CORS headers so `loadRemoteModule()` cross-origin fetches succeed. `@nx/web:file-server` exposes a `cors: boolean` option (verified in `node_modules/@nx/web/src/executors/file-server/schema.json`). Add `"cors": true` inside the `serve-static.options` block of:

- `apps/nestfolio-host/project.json`
- `apps/investor-mfe/project.json`
- `apps/ledger-mfe/project.json`
- `apps/onboarding-mfe/project.json`

Only add `cors: true`; do not change any other option in these files.

- [ ] **Step 4: Boot all six servers in parallel and eyeball ports**

```bash
pnpm nx run-many --target=build --projects=nestfolio-host,onboarding-mfe,investor-mfe,dashboard-mfe,advisory-mfe,ledger-mfe
pnpm nx run-many --target=serve-static --parallel=6 --projects=nestfolio-host,onboarding-mfe,investor-mfe,dashboard-mfe,advisory-mfe,ledger-mfe
```

Expected: six processes bind without "EADDRINUSE". In another terminal:
```bash
curl -s -o /dev/null -w "%{http_code} " http://localhost:4200 && \
curl -s -o /dev/null -w "%{http_code} " http://localhost:4201/remoteEntry.json && \
curl -s -o /dev/null -w "%{http_code} " http://localhost:4202/remoteEntry.json && \
curl -s -o /dev/null -w "%{http_code} " http://localhost:4203/remoteEntry.json && \
curl -s -o /dev/null -w "%{http_code} " http://localhost:4204/remoteEntry.json && \
curl -s -o /dev/null -w "%{http_code} " http://localhost:4205/remoteEntry.json && echo
```
Expected: `200 200 200 200 200 200`.

Also verify CORS header from one cross-origin MFE:
```bash
curl -s -I -H "Origin: http://localhost:4200" http://localhost:4205/remoteEntry.json | grep -i access-control-allow-origin
```
Expected: `Access-Control-Allow-Origin: *` (or `http://localhost:4200`).

Kill the run-many with Ctrl-C once confirmed.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard-mfe/project.json apps/advisory-mfe/project.json \
  apps/nestfolio-host/project.json apps/investor-mfe/project.json \
  apps/ledger-mfe/project.json apps/onboarding-mfe/project.json
git commit -m "fix(mfe): align serve-static ports with federation manifest and enable CORS"
```

---

## Phase 1 — Spikes: resolve open questions

The spec identifies five open questions the plan must resolve during execution. Do them before touching the e2e app — the answers shape the code.

**Exit criteria:** Each of the five open questions has a concrete, documented answer. Any code artefacts from these spikes (e.g. the Amplify key format, the shell-side CTA wiring) are either committed now or queued as Phase 2 tasks.

### Task 1.1 — Spike: Amplify v6 localStorage key format

**Why:** `seedAmplifyTokens` writes directly into the host page's localStorage. Amplify v6's key format is version-specific. Wrong keys → `fetchAuthSession()` silently returns null → infinite redirect to `/login` → every journey fails in a confusing way.

**Files:**
- Read: `node_modules/@aws-amplify/auth/package.json` (note version)
- Read: `libs/shell/src/auth/auth.provider.ts` (confirms `Auth.Cognito.userPoolClientId` is the only identifier Amplify uses)

- [ ] **Step 1: Capture the live key format**

Boot the host (`pnpm nx serve nestfolio-host` or the dev flow developers already use). Sign in manually through the UI with any existing test account. In DevTools → Application → Local Storage → `http://localhost:4200`, copy every key that starts with `CognitoIdentityServiceProvider`.

Expected shape (Amplify v6, for reference — verify against what you see):
```
CognitoIdentityServiceProvider.<clientId>.LastAuthUser            → <username-or-sub>
CognitoIdentityServiceProvider.<clientId>.<lastAuthUser>.idToken
CognitoIdentityServiceProvider.<clientId>.<lastAuthUser>.accessToken
CognitoIdentityServiceProvider.<clientId>.<lastAuthUser>.refreshToken
CognitoIdentityServiceProvider.<clientId>.<lastAuthUser>.userData
CognitoIdentityServiceProvider.<clientId>.<lastAuthUser>.clockDrift
```

- [ ] **Step 2: Record the format in a code comment**

Paste the exact key list into a TOP-OF-FILE comment in `apps/nestfolio-e2e/src/fixtures/seed-amplify-tokens.ts` (created in Task 3.2). Example:
```ts
/**
 * Amplify v6 localStorage key format (verified against aws-amplify@<version> on 2026-04-22):
 *   CognitoIdentityServiceProvider.<clientId>.LastAuthUser               = <username>
 *   CognitoIdentityServiceProvider.<clientId>.<username>.idToken         = <JWT>
 *   CognitoIdentityServiceProvider.<clientId>.<username>.accessToken     = <JWT>
 *   CognitoIdentityServiceProvider.<clientId>.<username>.refreshToken    = <JWT>
 *   CognitoIdentityServiceProvider.<clientId>.<username>.clockDrift      = 0
 * Any change here must come with a re-check against a live Amplify session.
 */
```

- [ ] **Step 3: Commit (as part of Task 3.2; no standalone commit here)**

No commit now; Task 3.2 produces the first real file this block lives in. Keep the extracted format in your notes.

### Task 1.2 — Spike: `@nx/web:file-server` CORS approach

**Why:** Confirm the CORS option actually works cross-origin, so we don't discover at journey-run time that the manifest fetch fails.

- [ ] **Step 1: Already resolved — proceed**

The schema inspection in Phase 0 confirmed `@nx/web:file-server` accepts `cors: boolean`. Task 0.2 Step 3 already applied it to all six MFEs. Task 0.2 Step 4 already confirmed a cross-origin `Access-Control-Allow-Origin` header comes back. **No further work.**

Record the answer in commit message (done) — no additional action.

### Task 1.3 — Spike: `initiateDeposit` default flag state

**Why:** Step 7 of the journey clicks the Deposit CTA → `deposit-confirm` button. `confirmDisabled` in `deposit-page.component.ts:161-167` returns `true` when `!flagEnabled`. The spec recommends verifying the default state.

**Files:**
- Read: `services/investor/investor-bff/src/handlers/event-listener.ts:107-128` (confirmed: BROKER_CIRCUIT_OPEN disables, BROKER_CIRCUIT_CLOSED enables — no *seeding* handler)
- Read: `services/investor/investor-bff/src/schema.graphql` (search for `getFeatureFlags` and `updateFeatureFlag` shape)
- Read: `libs/ui/feature-flags/src/**/*.ts` (FeatureFlagsStore behavior when a flag is absent)

- [ ] **Step 1: Determine the default**

In `libs/ui/feature-flags/src`, find `isEnabled` — check whether a missing flag is treated as enabled or disabled. If missing-flag → disabled, Phase 5's fixture must flip `initiateDeposit` via `updateFeatureFlag(enabled: true)` before step 7.

If missing-flag → enabled, no fixture needed; skip Task 5 below.

Record the answer in the plan checkoff (just the commit message suffices; no new file).

- [ ] **Step 2: If flip is required, verify the IAM-auth path**

`updateFeatureFlag` is marked `@aws_iam` in the schema. The e2e tenant uses Cognito JWT, not IAM. Two options:
- (A) Use the e2e-feature-tests pattern (grep for `UPDATE_FEATURE_FLAG` in `apps/e2e-feature-tests/src/` — there is prior art for calling this from tests): test-support's `AppSyncClient` may already sign IAM.
- (B) If no prior art, call `investorBff.updateFeatureFlag` from a small IAM-signed helper.

Record the chosen option as a comment inside `apps/nestfolio-e2e/src/fixtures/enable-deposit-flag.ts` when that file is created in Task 4.2.

### Task 1.4 — Spike: AuthStore refresh + CTA wiring for step 5

**Why:** Step 5's success ("URL redirects to `/dashboard`") depends on two things the current code does not do:

1. **CTA-renderer has no click handler.** `onboarding-chat.component.ts:364-390` (`mountRenderer`) calls `ref.setInput(key, value)` for each input but does not subscribe to `ref.instance.clicked`. Clicking the final-CTA button is a no-op today.
2. **AuthStore never sees `onboardingCompletedAt`.** `app.config.ts:66-82` sets `user.onboardingCompletedAt` once at boot from the JWT claim `custom:onboarding_completed_at`. After the backend writes that attribute, no client code refreshes the session token or patches AuthStore. `onboardingCompletedGuard` (`libs/shell/src/auth/onboarding.guard.ts:23`) therefore returns `/onboarding` forever — so any post-onboarding nav to `/dashboard` bounces.

**Files to read for confirmation:**
- `apps/onboarding-mfe/src/app/onboarding/onboarding-chat.component.ts:364-390`
- `apps/onboarding-mfe/src/app/onboarding/renderers/cta-renderer.component.ts`
- `apps/nestfolio-host/src/app/app.config.ts:66-82`
- `libs/shell/src/auth/auth.service.ts:71-82` (`forceRefreshSession`)
- `libs/shell/src/stores/auth.store.ts:33-38` (`updateUser`)

- [ ] **Step 1: Design the minimum shell-side fix**

Option chosen (least-invasive, matches existing abstractions):

In `OnboardingChatComponent.mountRenderer`, when `toolName === 'render_cta'`, subscribe to `ref.instance.clicked` and:
1. Call `forceRefreshSession()` from `@nestfolio/shell/auth`.
2. Call the existing `getAuthUser()` to read the refreshed claims.
3. If `onboardingCompletedAt` is non-null, call `authStore.updateUser({ onboardingCompletedAt })`.
4. Call `router.navigate(['/dashboard'])`.

Fallback: if refresh fails or claims still don't include `onboardingCompletedAt` (eventual-consistency lag against PostConfirmation → custom attribute write), poll up to 10s with 500ms intervals before navigating. This is the behaviour we'd want in production too, so it's not test-only code.

- [ ] **Step 2: Queue as Phase 2 task**

This is a real shell-side fix, not test-only plumbing. Task 2.1 implements it with unit tests. **Do not ship the e2e harness before it lands on main**, because step 5 will hang otherwise.

### Task 1.5 — Spike: CI path-filter syntax

**Why:** Spec defers this to "plan picks the syntax to match `project_ci_pipeline.md`."

**Files:**
- Read: `/Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/project_ci_pipeline.md`
- Read (if present): `.github/workflows/*.yml` for existing CI wiring style

- [ ] **Step 1: Read the memory entry and any existing workflows**

```bash
ls -la .github/workflows/ 2>/dev/null
cat /Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/project_ci_pipeline.md
```

- [ ] **Step 2: Decide GitHub Actions vs. another engine, then lock the syntax**

If the repo is on GitHub Actions, the syntax is the `paths:` key under `on.pull_request` and `on.push`. Example glob patterns (document the chosen patterns here — insert exact values from your survey):
```yaml
on:
  pull_request:
    paths:
      - 'apps/*-mfe/**'
      - 'apps/nestfolio-host/**'
      - 'libs/shell/**'
      - 'libs/ui/**'
      - 'services/**/*-bff/**'
      - 'apps/nestfolio-e2e/**'
  schedule:
    - cron: '0 5 * * *'  # nightly full suite (UTC)
  workflow_dispatch: {}
```

If the repo uses a different engine, map the semantics 1:1 and record the equivalent syntax before proceeding.

Record the chosen engine + syntax in a one-line comment at the top of `.github/workflows/nestfolio-e2e.yml` (created in Task 9.1).

---

## Phase 2 — Shell-side fixes required for the journey

### Task 2.1 — Wire the onboarding CTA-renderer click → refresh + navigate

**Files:**
- Modify: `apps/onboarding-mfe/src/app/onboarding/onboarding-chat.component.ts`
- Test: `apps/onboarding-mfe/test/onboarding/onboarding-chat.component.test.ts` (create if missing; otherwise append to the existing spec)

- [ ] **Step 1: Write the failing test**

Target file: `apps/onboarding-mfe/test/onboarding/onboarding-chat.component.test.ts`

```ts
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AuthStore } from '@nestfolio/shell';
import * as authService from '@nestfolio/shell/auth';
import { OnboardingChatComponent } from '../../src/app/onboarding/onboarding-chat.component';

describe('OnboardingChatComponent — CTA renderer click', () => {
  it('refreshes session, updates AuthStore, navigates to /dashboard', async () => {
    const navigate = jest.fn().mockResolvedValue(true);
    const updateUser = jest.fn();
    const forceRefresh = jest
      .spyOn(authService, 'forceRefreshSession')
      .mockResolvedValue({ idToken: 'id', accessToken: 'access' });
    const getAuthUser = jest.spyOn(authService, 'getAuthUser').mockResolvedValue({
      userId: 'u', username: 'u', onboardingCompletedAt: '2026-04-22T00:00:00Z',
    });

    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: { navigate } },
        { provide: AuthStore, useValue: { updateUser, user: () => null } },
      ],
    });
    const fixture = TestBed.createComponent(OnboardingChatComponent);
    const instance = fixture.componentInstance as unknown as {
      onCtaClick(action: string): Promise<void>;
    };

    await instance.onCtaClick('GO_TO_DASHBOARD');

    expect(forceRefresh).toHaveBeenCalled();
    expect(getAuthUser).toHaveBeenCalled();
    expect(updateUser).toHaveBeenCalledWith({ onboardingCompletedAt: '2026-04-22T00:00:00Z' });
    expect(navigate).toHaveBeenCalledWith(['/dashboard']);
  });
});
```

- [ ] **Step 2: Run the test; confirm it fails**

```bash
pnpm nx test onboarding-mfe --testPathPattern=onboarding-chat.component
```
Expected: failure ("`onCtaClick` is not a function" or similar).

- [ ] **Step 3: Implement `onCtaClick` and wire the subscription**

In `apps/onboarding-mfe/src/app/onboarding/onboarding-chat.component.ts`:

1. Add imports:
   ```ts
   import { Router } from '@angular/router';
   import { forceRefreshSession, getAuthUser } from '@nestfolio/shell/auth';
   import { CtaRendererComponent } from './renderers/cta-renderer.component';
   ```
2. Inject `Router`:
   ```ts
   private readonly router = inject(Router);
   ```
3. Add a new method on the class:
   ```ts
   async onCtaClick(_action: string): Promise<void> {
     await forceRefreshSession();
     const user = await getAuthUser();
     if (user?.onboardingCompletedAt) {
       this.authStore.updateUser({ onboardingCompletedAt: user.onboardingCompletedAt });
     }
     await this.router.navigate(['/dashboard']);
   }
   ```
4. In `mountRenderer`, after the existing `ref.setInput` loop and BEFORE `slot.appendChild(...)`, add:
   ```ts
   if (toolName === 'render_cta') {
     const cta = ref.instance as CtaRendererComponent;
     cta.clicked.subscribe((action: string) => {
       void this.onCtaClick(action);
     });
   }
   ```

- [ ] **Step 4: Run the test; confirm it passes**

```bash
pnpm nx test onboarding-mfe --testPathPattern=onboarding-chat.component
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/onboarding-mfe/src/app/onboarding/onboarding-chat.component.ts \
        apps/onboarding-mfe/test/onboarding/onboarding-chat.component.test.ts
git commit -m "fix(onboarding-mfe): navigate to dashboard after final CTA

The CTA renderer emits a click but nothing listened. Now we force-refresh
the Amplify session so onboardingCompletedAt lands in the JWT claims,
patch AuthStore, then router.navigate(['/dashboard'])."
```

---

## Phase 3 — Nx scaffolding for `nestfolio-e2e`

**Exit criteria:** `pnpm nx run nestfolio-e2e:lint` passes (empty project). `pnpm nx run nestfolio-e2e:e2e --help` surfaces Playwright's help. `pnpm exec playwright --version` returns a version.

### Task 3.1 — Install Playwright

**Files:**
- Modify: `package.json` (root)

- [ ] **Step 1: Install dev dependency**

```bash
pnpm add -Dw @playwright/test
```

Expected: `@playwright/test` added under `devDependencies` of the ROOT `package.json` (the `-w` / `--workspace-root` flag targets the workspace root).

- [ ] **Step 2: Install Chromium**

```bash
pnpm exec playwright install chromium
```
Expected: Chromium downloaded into `~/Library/Caches/ms-playwright` (macOS) or equivalent. Do not install all browsers; we are Chromium-only in Phase 1.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add @playwright/test dev dependency"
```

### Task 3.2 — Create the `nestfolio-e2e` app skeleton

**Files:**
- Create: `apps/nestfolio-e2e/project.json`
- Create: `apps/nestfolio-e2e/tsconfig.json`
- Create: `apps/nestfolio-e2e/tsconfig.spec.json`
- Create: `apps/nestfolio-e2e/eslint.config.mjs`
- Create: `apps/nestfolio-e2e/.gitignore`

- [ ] **Step 1: Write `project.json`**

```json
{
  "name": "nestfolio-e2e",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "apps/nestfolio-e2e/src",
  "projectType": "application",
  "tags": ["scope:platform", "type:app"],
  "targets": {
    "e2e": {
      "executor": "nx:run-commands",
      "options": {
        "command": "pnpm exec playwright test --config apps/nestfolio-e2e/playwright.config.ts"
      },
      "dependsOn": [
        { "target": "build", "projects": ["nestfolio-host", "onboarding-mfe", "investor-mfe", "dashboard-mfe", "advisory-mfe", "ledger-mfe"] }
      ]
    },
    "e2e-ui": {
      "executor": "nx:run-commands",
      "options": {
        "command": "pnpm exec playwright test --config apps/nestfolio-e2e/playwright.config.ts --ui"
      }
    },
    "lint": {
      "executor": "@nx/eslint:lint"
    }
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compileOnSave": false,
  "files": [],
  "include": [],
  "references": [{ "path": "./tsconfig.spec.json" }]
}
```

- [ ] **Step 3: Write `tsconfig.spec.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "../../dist/out-tsc",
    "module": "esnext",
    "moduleResolution": "bundler",
    "types": ["node"],
    "strict": true,
    "esModuleInterop": true
  },
  "include": ["src/**/*.ts", "playwright.config.ts"]
}
```

- [ ] **Step 4: Write `eslint.config.mjs`**

Copy the shape used by `apps/e2e-feature-tests/eslint.config.mjs` 1:1 — it already handles the "TypeScript-in-an-app" case consistently with the rest of the repo.

```bash
cp apps/e2e-feature-tests/eslint.config.mjs apps/nestfolio-e2e/eslint.config.mjs
```

Then review the copy for anything that references `e2e-feature-tests` by name and rename to `nestfolio-e2e` (likely no matches — the file is structural).

- [ ] **Step 5: Write `.gitignore`**

```
test-results/
reports/
playwright-report/
```

- [ ] **Step 6: Run lint on the empty project**

```bash
pnpm nx run nestfolio-e2e:lint
```
Expected: PASS (nothing to lint yet).

- [ ] **Step 7: Commit**

```bash
git add apps/nestfolio-e2e/
git commit -m "chore(nestfolio-e2e): scaffold empty Nx app for Playwright harness"
```

### Task 3.3 — Playwright config with multi-webServer

**Files:**
- Create: `apps/nestfolio-e2e/playwright.config.ts`

- [ ] **Step 1: Write the config**

```ts
import { defineConfig, devices } from '@playwright/test';

const HOST_URL = 'http://localhost:4200';

const mfeServer = (app: string, port: number) => ({
  command: `pnpm nx run ${app}:serve-static`,
  url: `http://localhost:${port}`,
  reuseExistingServer: !process.env.CI,
  timeout: 120_000,
  stdout: 'pipe' as const,
  stderr: 'pipe' as const,
});

export default defineConfig({
  testDir: './src',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [
        ['list'],
        ['html', { open: 'never', outputFolder: 'reports/html' }],
        ['junit', { outputFile: 'reports/junit.xml' }],
      ]
    : 'list',
  timeout: 600_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: HOST_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    mfeServer('nestfolio-host', 4200),
    mfeServer('investor-mfe', 4201),
    mfeServer('dashboard-mfe', 4202),
    mfeServer('advisory-mfe', 4203),
    mfeServer('ledger-mfe', 4204),
    mfeServer('onboarding-mfe', 4205),
  ],
  outputDir: 'test-results',
});
```

- [ ] **Step 2: Sanity-check the config parses**

```bash
pnpm exec playwright test --config apps/nestfolio-e2e/playwright.config.ts --list
```
Expected: "No tests found" (the `src/` folder is empty) — no parse errors.

- [ ] **Step 3: Commit**

```bash
git add apps/nestfolio-e2e/playwright.config.ts
git commit -m "feat(nestfolio-e2e): add Playwright config with per-MFE webServers"
```

---

## Phase 4 — Test-support extensions

### Task 4.1 — Add `investorWebDistributionUrl()` to SsmCache

**Why:** Option (A) of spec §P3 points `copilotApiUrl` at the deployed CloudFront distribution. The distribution URL is published by `services/investor/investor-web/src/service.stack.ts:212-215` at SSM path `/nestfolio/${prefix}-investor-web/web/distributionUrl`.

**Files:**
- Modify: `libs/test-support/src/ssm-cache.ts`
- Test: `libs/test-support/test/ssm-cache.test.ts` (if present; else skip)

- [ ] **Step 1: Add the method**

Append to the class body of `SsmCache` in `libs/test-support/src/ssm-cache.ts`:

```ts
  /** CloudFront distribution URL for investor-web:
   * /nestfolio/{prefix}-investor-web/web/distributionUrl */
  async investorWebDistributionUrl(): Promise<string> {
    return this.get(`/nestfolio/${this.prefix}-investor-web/web/distributionUrl`);
  }
```

Place it immediately below `userPoolClientId()` to keep alphabetically adjacent SSM getters grouped.

- [ ] **Step 2: If a test file exists, add a unit test**

```bash
ls libs/test-support/test/ssm-cache.test.ts 2>/dev/null
```

If present, add a test mirroring the shape of the neighbouring `userPoolId` test. If absent, skip — test-support's unit-test coverage is currently aspirational and outside this plan's scope.

- [ ] **Step 3: Typecheck**

```bash
pnpm nx run test-support:test || true
pnpm nx typecheck test-support 2>/dev/null || pnpm nx build test-support
```
Expected: builds clean. (If the lib has no `typecheck` target, `build` suffices.)

- [ ] **Step 4: Commit**

```bash
git add libs/test-support/src/ssm-cache.ts
git commit -m "feat(test-support): add investorWebDistributionUrl() to SsmCache"
```

### Task 4.2 — (conditional) Enable-deposit-flag fixture helper

**Files:**
- Create: `apps/nestfolio-e2e/src/fixtures/enable-deposit-flag.ts` (ONLY IF Task 1.3 Step 1 concluded "flip required")

- [ ] **Step 1: Skip or implement based on Task 1.3 outcome**

If Task 1.3 concluded `initiateDeposit` defaults to enabled (absent-flag ≡ enabled), skip this task entirely.

If Task 1.3 concluded a flip is required, implement per the option chosen (A or B in Task 1.3 Step 2):

```ts
// apps/nestfolio-e2e/src/fixtures/enable-deposit-flag.ts
import { AppSyncClient, type TestContext } from '@nestfolio/test-support';
import type { FreshTenant } from '@nestfolio/e2e-feature-tests';

/**
 * Flip the `initiateDeposit` feature flag to `true` for the fresh tenant.
 * investor-bff's updateFeatureFlag mutation is @aws_iam — we use AppSyncClient
 * (which signs IAM) rather than the tenant's Cognito JWT.
 *
 * Reason for a fresh call per journey: the flag is tenant-scoped DDB state;
 * BROKER_CIRCUIT_OPEN handlers in e2e-feature-tests runs may have left it off.
 */
export async function enableDepositFlag(ctx: TestContext, _tenant: FreshTenant): Promise<void> {
  const url = await ctx.ssm.graphqlUrl('investor-bff');
  const appsync = new AppSyncClient(ctx, url);
  await appsync.query(`
    mutation Enable { updateFeatureFlag(name: "initiateDeposit", enabled: true) { name enabled } }
  `, {});
}
```

Adjust `AppSyncClient.query()` arguments to match whatever signature the library currently exposes — read `libs/test-support/src/fixtures/appsync-client.ts` first.

- [ ] **Step 2: Commit (if file was created)**

```bash
git add apps/nestfolio-e2e/src/fixtures/enable-deposit-flag.ts
git commit -m "feat(nestfolio-e2e): add enableDepositFlag fixture helper"
```

---

## Phase 5 — Fixtures

### Task 5.1 — `seedAmplifyTokens` + post-seed assertion

**Files:**
- Create: `apps/nestfolio-e2e/src/fixtures/seed-amplify-tokens.ts`

- [ ] **Step 1: Write the file**

```ts
import type { Page } from '@playwright/test';
import type { CognitoTokens } from '@nestfolio/test-support';

/**
 * Amplify v6 localStorage key format (verified against aws-amplify@<FILL-FROM-TASK-1.1>
 * on 2026-04-22):
 *   CognitoIdentityServiceProvider.<clientId>.LastAuthUser               = <username>
 *   CognitoIdentityServiceProvider.<clientId>.<username>.idToken         = <JWT>
 *   CognitoIdentityServiceProvider.<clientId>.<username>.accessToken     = <JWT>
 *   CognitoIdentityServiceProvider.<clientId>.<username>.refreshToken    = <JWT>
 *   CognitoIdentityServiceProvider.<clientId>.<username>.clockDrift      = 0
 * If Amplify is upgraded, re-run the Task 1.1 spike and update both the
 * keys below and this comment.
 */

export interface SeedOptions {
  clientId: string;
  username: string;
  tokens: CognitoTokens;
}

export async function seedAmplifyTokens(page: Page, opts: SeedOptions): Promise<void> {
  const { clientId, username, tokens } = opts;
  await page.addInitScript(
    ({ clientId, username, idToken, accessToken }) => {
      const prefix = `CognitoIdentityServiceProvider.${clientId}`;
      localStorage.setItem(`${prefix}.LastAuthUser`, username);
      localStorage.setItem(`${prefix}.${username}.idToken`, idToken);
      localStorage.setItem(`${prefix}.${username}.accessToken`, accessToken);
      // refreshToken is intentionally empty — test sessions are short-lived;
      // forceRefresh calls in-session will fail and the code falls back to
      // the still-valid idToken. If a future test needs >1h, capture a real
      // refreshToken via CognitoFixture.setup and plumb it through.
      localStorage.setItem(`${prefix}.${username}.refreshToken`, '');
      localStorage.setItem(`${prefix}.${username}.clockDrift`, '0');
    },
    { clientId, username, idToken: tokens.idToken, accessToken: tokens.accessToken },
  );
}

/**
 * Call AFTER navigating to the host root. Fails fast if fetchAuthSession()
 * still returns null — the silent-failure mode of wrong-keys is the single
 * largest time-sink risk in this harness.
 */
export async function assertAmplifySessionAlive(page: Page): Promise<void> {
  const session = await page.evaluate(async () => {
    const { fetchAuthSession } = await import('aws-amplify/auth');
    const s = await fetchAuthSession();
    return {
      hasIdToken: !!s.tokens?.idToken?.toString(),
      hasAccessToken: !!s.tokens?.accessToken?.toString(),
    };
  });
  if (!session.hasIdToken || !session.hasAccessToken) {
    throw new Error(
      'seedAmplifyTokens: fetchAuthSession() returned no tokens after seeding. ' +
        'Amplify v6 key format may have changed — re-run the Task 1.1 spike.',
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/nestfolio-e2e/src/fixtures/seed-amplify-tokens.ts
git commit -m "feat(nestfolio-e2e): seed Amplify v6 localStorage tokens with live assertion"
```

### Task 5.2 — `tenant` + `authedPage` fixtures

**Files:**
- Create: `apps/nestfolio-e2e/src/fixtures/test.ts`

- [ ] **Step 1: Write the file**

```ts
import { test as base, type Page } from '@playwright/test';
import { createTestContext, type TestContext } from '@nestfolio/test-support';
import { freshTenant, type FreshTenant } from '@nestfolio/e2e-feature-tests';
import { seedAmplifyTokens, assertAmplifySessionAlive } from './seed-amplify-tokens';

interface Fx {
  ctx: TestContext;
  tenant: FreshTenant;
  authedPage: Page;
}

/**
 * Derive the username Amplify will write into LastAuthUser. CognitoFixture
 * creates `integ-${Date.now()}@test.nestfolio.dev` as the username AND email;
 * Amplify uses the username portion verbatim.
 */
function deriveUsername(tenant: FreshTenant): string {
  // CognitoFixture stores the username on itself; it isn't currently returned
  // by freshTenant(). Decode it from the id token's `cognito:username` claim.
  const [, payload] = tenant.idToken.split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
    'cognito:username'?: string;
  };
  const username = claims['cognito:username'];
  if (!username) throw new Error('idToken missing cognito:username claim');
  return username;
}

export const test = base.extend<Fx>({
  ctx: async ({}, use) => {
    const ctx = await createTestContext();
    await use(ctx);
    await ctx.cleanup.runAll();
  },
  tenant: async ({ ctx }, use) => {
    const tenant = await freshTenant(ctx);
    await use(tenant);
  },
  authedPage: async ({ ctx, tenant, page }, use) => {
    const clientId = await ctx.ssm.userPoolClientId();
    const username = deriveUsername(tenant);
    await seedAmplifyTokens(page, {
      clientId,
      username,
      tokens: tenant.cognitoTokens,
    });
    await page.goto('/');
    await assertAmplifySessionAlive(page);
    await use(page);
  },
});

export { expect } from '@playwright/test';
```

- [ ] **Step 2: Commit**

```bash
git add apps/nestfolio-e2e/src/fixtures/test.ts
git commit -m "feat(nestfolio-e2e): add tenant + authedPage fixtures"
```

---

## Phase 6 — data-testid additions on onboarding renderers

The journey's POM methods need stable selectors on each renderer. CSS-class selectors are too brittle. Spec mandates adding `data-testid` attributes to the 7 renderer components plus slot markers on the chat host.

**Exit criteria:** Each renderer exposes a predictable `data-testid` surface used by the POMs; a small unit test prevents regression.

### Task 6.1 — Slot marker in `onboarding-chat.component.ts`

**Files:**
- Modify: `apps/onboarding-mfe/src/app/onboarding/onboarding-chat.component.ts`

- [ ] **Step 1: Tag the renderer slot by tool name**

In the chat template (line 96-101 approximate), currently:
```html
@if (msg.role === 'assistant' && msg.toolName) {
  <div [attr.data-tool-slot]="msg.id" class="renderer-slot"></div>
}
```

Change to also emit `data-testid="renderer-<toolName>"`:
```html
@if (msg.role === 'assistant' && msg.toolName) {
  <div
    [attr.data-tool-slot]="msg.id"
    [attr.data-testid]="'renderer-' + msg.toolName"
    class="renderer-slot"
  ></div>
}
```

- [ ] **Step 2: Rebuild + manually verify**

```bash
pnpm nx build onboarding-mfe
```
(Visual verification is impractical in a headless flow; the unit test in the next renderer tasks will catch it.)

- [ ] **Step 3: Commit**

```bash
git add apps/onboarding-mfe/src/app/onboarding/onboarding-chat.component.ts
git commit -m "feat(onboarding-mfe): tag renderer slots with data-testid for Playwright POMs"
```

### Task 6.2 — `options-renderer` — `data-testid="option-<value>"`

**Files:**
- Modify: `apps/onboarding-mfe/src/app/onboarding/renderers/options-renderer.component.ts`
- Test: `apps/onboarding-mfe/test/onboarding/renderers/options-renderer.component.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { TestBed } from '@angular/core/testing';
import { OptionsRendererComponent } from '../../../src/app/onboarding/renderers/options-renderer.component';

describe('OptionsRendererComponent — data-testid', () => {
  it('emits data-testid="option-<value>" per option', () => {
    TestBed.configureTestingModule({ imports: [OptionsRendererComponent] });
    const fixture = TestBed.createComponent(OptionsRendererComponent);
    fixture.componentRef.setInput('options', [
      { value: 'GROWTH', label: 'Growth' },
      { value: 'INCOME', label: 'Income' },
    ]);
    fixture.detectChanges();
    const growth = fixture.nativeElement.querySelector('[data-testid="option-GROWTH"]');
    const income = fixture.nativeElement.querySelector('[data-testid="option-INCOME"]');
    expect(growth).toBeTruthy();
    expect(income).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test; confirm it fails**

```bash
pnpm nx test onboarding-mfe --testPathPattern=options-renderer
```
Expected: FAIL.

- [ ] **Step 3: Add `data-testid` to the template**

Read the current template of `options-renderer.component.ts`. On the per-option element (likely a `<button>` inside an `@for`), add `[attr.data-testid]="'option-' + opt.value"` (or whatever the local loop variable is).

- [ ] **Step 4: Run the test; confirm it passes**

```bash
pnpm nx test onboarding-mfe --testPathPattern=options-renderer
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/onboarding-mfe/src/app/onboarding/renderers/options-renderer.component.ts \
        apps/onboarding-mfe/test/onboarding/renderers/options-renderer.component.test.ts
git commit -m "feat(onboarding-mfe): tag options renderer with data-testid"
```

### Task 6.3 — `mode-cards-renderer` — `data-testid="mode-<value>"`

**Files:**
- Modify: `apps/onboarding-mfe/src/app/onboarding/renderers/mode-cards-renderer.component.ts`
- Test: `apps/onboarding-mfe/test/onboarding/renderers/mode-cards-renderer.component.test.ts`

Follow the exact TDD shape of Task 6.2, substituting:
- Component: `ModeCardsRendererComponent`
- Input name: whatever the component accepts (read the file — likely `modes` or `options`)
- Expected selectors: `[data-testid="mode-AGGRESSIVE"]`, `[data-testid="mode-BALANCED"]`, `[data-testid="mode-CONSERVATIVE"]`

Apply the same 5-step TDD loop: failing test, run, implement, pass, commit.

Commit message: `feat(onboarding-mfe): tag mode-cards renderer with data-testid`

### Task 6.4 — `slider-renderer` — `data-testid="slider-input"`

**Files:**
- Modify: `apps/onboarding-mfe/src/app/onboarding/renderers/slider-renderer.component.ts`
- Test: `apps/onboarding-mfe/test/onboarding/renderers/slider-renderer.component.test.ts`

Add `data-testid="slider-input"` to the `<input type="range">` element. Test asserts the element exists and Playwright can set its value by evaluating a native `input` event.

TDD loop (failing test → run → implement → pass → commit) same shape as Task 6.2. Commit message: `feat(onboarding-mfe): tag slider renderer with data-testid`.

### Task 6.5 — `amount-renderer` — `data-testid="amount-input"` + `data-testid="amount-submit"`

**Files:**
- Modify: `apps/onboarding-mfe/src/app/onboarding/renderers/amount-renderer.component.ts`
- Test: `apps/onboarding-mfe/test/onboarding/renderers/amount-renderer.component.test.ts`

Tag the numeric input and the confirm button. TDD loop same shape. Commit: `feat(onboarding-mfe): tag amount renderer with data-testid`.

### Task 6.6 — `summary-renderer` — `data-testid="summary-confirm"`

TDD loop same shape. Commit: `feat(onboarding-mfe): tag summary renderer with data-testid`.

### Task 6.7 — `consent-renderer` — `data-testid="consent-accept"`

Tag the consent checkbox OR the confirm button (whichever the POM will click). Read the component first and pick the single action surface.

TDD loop same shape. Commit: `feat(onboarding-mfe): tag consent renderer with data-testid`.

### Task 6.8 — `cta-renderer` — `data-testid="cta-primary"`

**Files:**
- Modify: `apps/onboarding-mfe/src/app/onboarding/renderers/cta-renderer.component.ts`
- Test: `apps/onboarding-mfe/test/onboarding/renderers/cta-renderer.component.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { TestBed } from '@angular/core/testing';
import { CtaRendererComponent } from '../../../src/app/onboarding/renderers/cta-renderer.component';

describe('CtaRendererComponent — data-testid', () => {
  it('exposes data-testid="cta-primary"', () => {
    TestBed.configureTestingModule({ imports: [CtaRendererComponent] });
    const fixture = TestBed.createComponent(CtaRendererComponent);
    fixture.componentRef.setInput('label', 'Go');
    fixture.componentRef.setInput('action', 'GO_TO_DASHBOARD');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="cta-primary"]')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Confirm failure**

```bash
pnpm nx test onboarding-mfe --testPathPattern=cta-renderer
```

- [ ] **Step 3: Add the attribute**

In `cta-renderer.component.ts` template:
```html
<button class="cta-button" data-testid="cta-primary" (click)="onClick()">{{ label() }}</button>
```

- [ ] **Step 4: Confirm pass**

```bash
pnpm nx test onboarding-mfe --testPathPattern=cta-renderer
```

- [ ] **Step 5: Commit**

```bash
git add apps/onboarding-mfe/src/app/onboarding/renderers/cta-renderer.component.ts \
        apps/onboarding-mfe/test/onboarding/renderers/cta-renderer.component.test.ts
git commit -m "feat(onboarding-mfe): tag CTA renderer with data-testid"
```

---

## Phase 7 — Page Object Models

One POM per MFE. Scenario specs never touch raw locators — they go through the POM. Each POM grows only the methods the journey needs.

### Task 7.1 — `OnboardingChatPage`

**Files:**
- Create: `apps/nestfolio-e2e/src/pages/onboarding.page.ts`

- [ ] **Step 1: Write the file**

```ts
import type { Page } from '@playwright/test';

export type RendererTool =
  | 'render_options' | 'render_mode_cards' | 'render_slider'
  | 'render_amount'  | 'render_summary'    | 'render_consent' | 'render_cta';

export type OperatingMode = 'AGGRESSIVE' | 'BALANCED' | 'CONSERVATIVE';

export class OnboardingChatPage {
  constructor(readonly page: Page) {}

  goto() {
    return this.page.goto('/onboarding');
  }

  waitForRenderer(tool: RendererTool, timeout = 30_000) {
    return this.page.getByTestId(`renderer-${tool}`).first().waitFor({ timeout });
  }

  selectOption(value: string) {
    return this.page.getByTestId(`option-${value}`).click();
  }

  selectMode(m: OperatingMode) {
    return this.page.getByTestId(`mode-${m}`).click();
  }

  async setSlider(value: number): Promise<void> {
    const slider = this.page.getByTestId('slider-input');
    await slider.fill(String(value));
    await slider.dispatchEvent('input');
    await slider.dispatchEvent('change');
  }

  async setAmount(valueCents: number): Promise<void> {
    const display = (valueCents / 100).toString();
    const input = this.page.getByTestId('amount-input');
    await input.fill(display);
    await this.page.getByTestId('amount-submit').click();
  }

  confirmSummary() {
    return this.page.getByTestId('summary-confirm').click();
  }

  grantConsent() {
    return this.page.getByTestId('consent-accept').click();
  }

  clickCta() {
    return this.page.getByTestId('cta-primary').click();
  }

  async sendMessage(text: string): Promise<void> {
    await this.page.getByPlaceholder('Scrivi un messaggio...').fill(text);
    await this.page.getByRole('button', { name: 'Invia' }).click();
  }

  async phaseIndex(): Promise<number> {
    // Progress label renders as "<phaseIndex+1> di <total>" — parse back.
    const label = await this.page.locator('.progress-label').first().innerText();
    const match = /^(\d+)\s+di\s+\d+$/.exec(label.trim());
    if (!match) throw new Error(`Unexpected progress label: "${label}"`);
    return parseInt(match[1], 10) - 1;
  }

  async waitForAssistantReply(timeout = 60_000): Promise<void> {
    // Assistant bubbles have role 'assistant' and non-empty text.
    // Wait for a new assistant bubble to appear (POM caller ensures at least
    // one new turn after the prior call).
    await this.page
      .locator('.chat-bubble.assistant')
      .filter({ hasText: /\S/ })
      .last()
      .waitFor({ timeout });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/nestfolio-e2e/src/pages/onboarding.page.ts
git commit -m "feat(nestfolio-e2e): add OnboardingChatPage POM"
```

### Task 7.2 — `DashboardPage`

**Files:**
- Create: `apps/nestfolio-e2e/src/pages/dashboard.page.ts`

- [ ] **Step 1: Write the file**

```ts
import { expect, type Page } from '@playwright/test';

export class DashboardPage {
  constructor(readonly page: Page) {}

  goto() {
    return this.page.goto('/dashboard');
  }

  /** Wait for the KPI cards row — proves the dashboard read model loaded. */
  async waitForLoaded(timeout = 60_000): Promise<void> {
    await this.page.getByTestId('cta-deposit').waitFor({ timeout });
  }

  clickDeposit() {
    return this.page.getByTestId('cta-deposit').click();
  }

  /** Wait for the pending-decisions counter on AdvisoryAlertBar to be ≥ n.
   * We assert on the full alert-bar text (which contains "Decisioni in sospeso: N"
   * in Italian after i18n) and extract the number via regex. */
  async waitForPendingDecisionsAtLeast(n: number, timeout = 180_000): Promise<void> {
    await expect(async () => {
      const text = await this.page.locator('.alert-bar .alert-text').innerText();
      const match = /:\s*(\d+)/.exec(text);
      const count = match ? parseInt(match[1], 10) : 0;
      expect(count).toBeGreaterThanOrEqual(n);
    }).toPass({ timeout, intervals: [1000, 2000, 5000] });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/nestfolio-e2e/src/pages/dashboard.page.ts
git commit -m "feat(nestfolio-e2e): add DashboardPage POM"
```

### Task 7.3 — `InvestorPage` (deposit)

**Files:**
- Create: `apps/nestfolio-e2e/src/pages/investor.page.ts`

- [ ] **Step 1: Write the file**

```ts
import type { Page } from '@playwright/test';

export class InvestorPage {
  constructor(readonly page: Page) {}

  gotoDeposit() {
    return this.page.goto('/investor/deposit');
  }

  waitForDepositForm(timeout = 30_000) {
    return this.page.getByTestId('deposit-form').waitFor({ timeout });
  }

  async enterAmount(amount: number): Promise<void> {
    // p-inputNumber renders a real <input> inside; target it by data-testid parent.
    const inputWrapper = this.page.getByTestId('deposit-amount');
    const nativeInput = inputWrapper.locator('input');
    await nativeInput.fill(String(amount));
    await nativeInput.blur();
  }

  confirm() {
    return this.page.getByTestId('deposit-confirm').click();
  }

  waitForInitiated(timeout = 60_000) {
    return this.page.getByTestId('deposit-panel-initiated').waitFor({ timeout });
  }

  waitForDetected(timeout = 120_000) {
    return this.page.getByTestId('deposit-panel-detected').waitFor({ timeout });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/nestfolio-e2e/src/pages/investor.page.ts
git commit -m "feat(nestfolio-e2e): add InvestorPage POM (deposit)"
```

### Task 7.4 — `AdvisoryPage`

**Files:**
- Create: `apps/nestfolio-e2e/src/pages/advisory.page.ts`

- [ ] **Step 1: Write the file**

```ts
import { expect, type Page } from '@playwright/test';

export class AdvisoryPage {
  constructor(readonly page: Page) {}

  /**
   * Navigate to /advisory (list view) and click the first pending decision.
   * The list is expected to be present because DashboardPage.waitForPendingDecisionsAtLeast(1)
   * already passed — advisory projection is materialised.
   */
  async goToFirstPendingDecision(): Promise<void> {
    await this.page.goto('/advisory');
    // The advisory-mfe list view renders decision cards; click the first one.
    // Generic selector since list-item testids are out-of-scope for Phase 1.
    await this.page.locator('[data-testid^="decision-"]').first().click();
    await expect(this.page).toHaveURL(/\/advisory\/[0-9a-f-]{36}/);
  }

  async waitForRationale(timeout = 60_000): Promise<void> {
    await this.page.locator('.rationale').waitFor({ timeout });
  }

  async rationaleText(): Promise<string> {
    return (await this.page.locator('.rationale').innerText()).trim();
  }

  /** Click Confirm. Uses PrimeNG's <p-button label="..."> DOM shape. */
  async confirm(): Promise<void> {
    // advisory.detail.confirm translates to the label rendered inside the p-button.
    // Matching by role+name keeps the POM robust to structure churn.
    await this.page.getByRole('button', { name: /confirm|conferma/i }).click();
  }

  async waitForConfirmed(timeout = 60_000): Promise<void> {
    // StatusBadge shows updated status; the success message banner also appears.
    await expect(this.page.locator('p-message[severity="success"], .p-message-success'))
      .toBeVisible({ timeout });
  }
}
```

Note: `[data-testid^="decision-"]` assumes list items expose one. If they don't, downgrade to a generic list-card selector and leave a TODO in the POM. Verify by reading `apps/advisory-mfe/src/app/decision-list/*.ts` during Task 8 step-3 debugging; if missing, add `data-testid="decision-${decisionId}"` in the list component as a follow-up. Do not do this up-front — YAGNI until the journey actually needs it.

- [ ] **Step 2: Commit**

```bash
git add apps/nestfolio-e2e/src/pages/advisory.page.ts
git commit -m "feat(nestfolio-e2e): add AdvisoryPage POM"
```

### Task 7.5 — `HostPage` (logout)

**Files:**
- Create: `apps/nestfolio-e2e/src/pages/host.page.ts`

- [ ] **Step 1: Write the file**

```ts
import { expect, type Page } from '@playwright/test';

export class HostPage {
  constructor(readonly page: Page) {}

  logout() {
    return this.page.getByTestId('cta-logout').click();
  }

  async waitForLogin(timeout = 30_000): Promise<void> {
    await expect(this.page).toHaveURL(/\/login$/, { timeout });
  }

  async assertAuthStoreUnauthenticated(): Promise<void> {
    // LogoutButtonComponent renders only when authStore.status() === 'authenticated'.
    // Its absence is the UI-visible proof the store is reset.
    await expect(this.page.getByTestId('cta-logout')).toBeHidden();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/nestfolio-e2e/src/pages/host.page.ts
git commit -m "feat(nestfolio-e2e): add HostPage POM (logout)"
```

---

## Phase 8 — The journey spec

**Exit criteria:** `pnpm nx run nestfolio-e2e:e2e` green locally, cold cache, end-to-end.

### Task 8.1 — Write `new-investor-happy-path.spec.ts`

**Files:**
- Create: `apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts`

- [ ] **Step 1: Write the file**

```ts
import { test, expect } from '../fixtures/test';
import { AgentTraceTrap } from '@nestfolio/e2e-feature-tests';
import { OnboardingChatPage, type OperatingMode } from '../pages/onboarding.page';
import { DashboardPage } from '../pages/dashboard.page';
import { InvestorPage } from '../pages/investor.page';
import { AdvisoryPage } from '../pages/advisory.page';
import { HostPage } from '../pages/host.page';
// Uncomment and import if Task 4.2 produced this file:
// import { enableDepositFlag } from '../fixtures/enable-deposit-flag';

test('new-investor-happy-path: onboarding → deposit → decision → logout', async ({ ctx, tenant, authedPage }) => {
  const onboarding = new OnboardingChatPage(authedPage);
  const dashboard = new DashboardPage(authedPage);
  const investor = new InvestorPage(authedPage);
  const advisory = new AdvisoryPage(authedPage);
  const host = new HostPage(authedPage);

  // Step 1 — arm AgentTraceTrap for onboarding BEFORE any agent-triggering action.
  const trap = await test.step('arm agent trace trap', () =>
    AgentTraceTrap.arm(ctx, 'onboarding'));

  // Step 2 — navigate to /onboarding; shell routes to onboarding-mfe.
  await test.step('route to onboarding', async () => {
    await onboarding.goto();
    await expect(authedPage).toHaveURL(/\/onboarding$/);
    // First renderer proves the graph started AND native-federation loaded the remote.
    await onboarding.waitForRenderer('render_options', 60_000);
    expect(await onboarding.phaseIndex()).toBe(0);
  });

  // Step 3 — walk phases 0..4 (options → mode-cards → slider → amount → summary).
  await test.step('phase 0: options', async () => {
    await onboarding.selectOption('GROWTH');
    await onboarding.waitForRenderer('render_mode_cards');
    expect(await onboarding.phaseIndex()).toBe(1);
  });

  const pickedMode: OperatingMode = 'BALANCED';
  await test.step('phase 1: mode cards', async () => {
    await onboarding.selectMode(pickedMode);
    await onboarding.waitForRenderer('render_slider');
    expect(await onboarding.phaseIndex()).toBe(2);
  });

  await test.step('phase 2: slider', async () => {
    await onboarding.setSlider(10);
    await onboarding.waitForRenderer('render_amount');
    expect(await onboarding.phaseIndex()).toBe(3);
  });

  await test.step('phase 3: amount', async () => {
    await onboarding.setAmount(50_000_00);
    await onboarding.waitForRenderer('render_summary');
    expect(await onboarding.phaseIndex()).toBe(4);
  });

  await test.step('phase 4: summary', async () => {
    await onboarding.confirmSummary();
    await onboarding.waitForRenderer('render_consent');
    expect(await onboarding.phaseIndex()).toBe(5);
  });

  // Step 4 — mid-wizard product question → KB interaction (transitional observability).
  // The spec explicitly allows a single observability assertion for the KB tool call
  // because no UI citations surface exists yet (Phase 2 / Phase 3 future work).
  await test.step('KB plumbing: ask a product question', async () => {
    await onboarding.sendMessage('Come funziona il rebalancing?');
    await onboarding.waitForAssistantReply(90_000);

    // correlationId for onboarding traces is the tenantId (verify against trap
    // output shape on first run — AgentTraceEventDetail.correlationId semantics
    // for the onboarding agent live in libs/agent-orchestrator/src/agent-tracer.ts).
    const traces = await trap.waitFor({
      correlationId: tenant.tenantId,
      minCount: 1,
      timeoutMs: 90_000,
    });
    const kbCall = traces
      .flatMap((t) => t.toolCalls ?? [])
      .find((c) => c.toolName === 'search_knowledge_base');
    expect(kbCall, 'expected a search_knowledge_base tool call on onboarding bus').toBeTruthy();
    expect(kbCall!.status).toBe('success');
    expect(Object.keys(kbCall!.args ?? {})).toContain('query');
  });

  // Step 5 — consent + CTA; after CTA, OnboardingChatComponent.onCtaClick
  //          forces Amplify session refresh and navigates to /dashboard.
  await test.step('phase 5: consent', async () => {
    await onboarding.grantConsent();
    await onboarding.waitForRenderer('render_cta');
    expect(await onboarding.phaseIndex()).toBe(6);
  });

  await test.step('phase 6: CTA → redirect', async () => {
    await onboarding.clickCta();
    await expect(authedPage).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
  });

  // Step 6 — dashboard renders post-onboarded shell.
  await test.step('dashboard loaded', async () => {
    await dashboard.waitForLoaded();
  });

  // Step 7 — fund account flow.
  await test.step('deposit: form → initiated → detected', async () => {
    // Commented-out branch: if Task 1.3 concluded flag must be flipped, uncomment.
    // await enableDepositFlag(ctx, tenant);

    await dashboard.clickDeposit();
    await expect(authedPage).toHaveURL(/\/investor\/deposit$/);
    await investor.waitForDepositForm();
    await investor.enterAmount(5000);
    await investor.confirm();
    await investor.waitForInitiated();
    await investor.waitForDetected();
  });

  // Step 8 — pending-decisions counter advances on the dashboard.
  await test.step('decision pipeline triggers', async () => {
    await authedPage.goto('/dashboard');
    await dashboard.waitForPendingDecisionsAtLeast(1, 180_000);
  });

  // Step 9-10 — read rationale; accept decision.
  await test.step('open decision, read rationale, confirm', async () => {
    await advisory.goToFirstPendingDecision();
    await advisory.waitForRationale();
    const rationale = await advisory.rationaleText();
    expect(rationale.length).toBeGreaterThan(10);  // non-empty narrative agent output
    await advisory.confirm();
    await advisory.waitForConfirmed();
  });

  // Step 11 — logout.
  await test.step('logout', async () => {
    await host.logout();
    await host.waitForLogin();
    await host.assertAuthStoreUnauthenticated();
  });
});
```

- [ ] **Step 2: Typecheck the spec**

```bash
pnpm exec tsc --noEmit -p apps/nestfolio-e2e/tsconfig.spec.json
```
Expected: no errors. Fix import paths / signature mismatches if any.

- [ ] **Step 3: Run the journey cold on real sandbox AWS**

Preconditions:
- Leapp session on account 771924376645 is active (`aws sts get-caller-identity` returns the dev account).
- `NESTFOLIO_INTEG_PREFIX=dev`.
- Deployed sandbox URL is not stale (spec §Acceptance — step 7 depends on the investor-web distribution being deployed).

```bash
NESTFOLIO_INTEG_PREFIX=dev AWS_REGION=us-east-1 pnpm nx run nestfolio-e2e:e2e
```

Expected: GREEN end-to-end. On the first run, expect 1-2 iterations of debugging — typical issues:
- AgentTraceTrap `correlationId` wiring: trap.waitFor returns empty → check the actual `correlationId` semantics on the onboarding trace envelope (read `libs/agent-orchestrator/src/agent-tracer.ts` + `services/investor/onboarding-bff/src/agent/`), adjust the expect argument.
- Advisory decision list selector: `[data-testid^="decision-"]` may not exist yet. Read `apps/advisory-mfe/src/app/decision-list/*` and either add the testid (small PR) or adjust the POM selector (POM change, no production code change).
- Amplify session "dies" mid-journey: JWT idToken has a 1h TTL — unlikely to blow up a 3-5 minute journey, but if you see 401s late in the run, the `refreshToken: ''` placeholder in `seedAmplifyTokens` is biting. Fix by capturing a real refresh token from CognitoFixture and threading it through.

- [ ] **Step 4: Commit once green**

```bash
git add apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts
git commit -m "feat(nestfolio-e2e): add new-investor-happy-path journey"
```

---

## Phase 9 — CI wiring

**Exit criteria:** PR touching a frontend or BFF path runs the e2e job with the deployed sandbox; nightly cron runs it unconditionally; a `/run-e2e` PR comment (or workflow_dispatch button) forces it. Failure attaches `reports/html`, `reports/junit.xml`, and `test-results/` (traces, screenshots, video).

### Task 9.1 — GitHub Actions workflow

**Files:**
- Create: `.github/workflows/nestfolio-e2e.yml`

- [ ] **Step 1: Write the workflow**

```yaml
# CI engine: GitHub Actions.
# Path-filter syntax: on.pull_request.paths + on.push.paths.
# On-demand: workflow_dispatch. Nightly: schedule cron.
name: nestfolio-e2e

on:
  pull_request:
    paths:
      - 'apps/*-mfe/**'
      - 'apps/nestfolio-host/**'
      - 'apps/nestfolio-e2e/**'
      - 'libs/shell/**'
      - 'libs/ui/**'
      - 'services/**/*-bff/**'
      - '.github/workflows/nestfolio-e2e.yml'
  schedule:
    - cron: '0 5 * * *'  # 05:00 UTC nightly
  workflow_dispatch: {}

jobs:
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions:
      id-token: write       # OIDC assume-role
      contents: read
      actions: read
    env:
      NESTFOLIO_INTEG_PREFIX: dev
      AWS_REGION: us-east-1
      CI: 'true'
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_OIDC_ROLE_ARN }}
          aws-region: us-east-1
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm nx run nestfolio-e2e:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: |
            apps/nestfolio-e2e/reports/
            apps/nestfolio-e2e/test-results/
          retention-days: 14
```

Replace the exact secret name `AWS_OIDC_ROLE_ARN` with whatever the repo's `project_ci_pipeline.md` documents (read it in Task 1.5). If a different path-filter syntax applies (non-GitHub engine), translate 1:1.

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/nestfolio-e2e.yml
git commit -m "ci: add nestfolio-e2e job with path-filter + nightly + on-demand"
```

### Task 9.2 — On-demand PR comment trigger (optional)

**Files:**
- Modify: `.github/workflows/nestfolio-e2e.yml`

- [ ] **Step 1: Decide**

If the repo already has a `/run-<job>` comment convention (likely documented in `project_ci_pipeline.md`), extend it. Otherwise `workflow_dispatch` in Task 9.1 already satisfies the on-demand requirement — skip this task.

---

## Phase 10 — Stability bar + acceptance

**Exit criteria:** All items in spec §Acceptance criteria are checked. Ten consecutive main-branch CI runs pass.

### Task 10.1 — Boot-time budget

**Spec requirement:** Six-server boot completes in ≤ 15s local, ≤ 30s CI.

- [ ] **Step 1: Measure locally**

```bash
time pnpm nx run-many --target=serve-static --parallel=6 --projects=nestfolio-host,onboarding-mfe,investor-mfe,dashboard-mfe,advisory-mfe,ledger-mfe &
# Wait until all six respond 200; Ctrl-C.
```

Expected: < 15s to all-200. If it exceeds 15s, inspect: (a) CPU on dev machine; (b) whether `@nx/web:file-server` is re-reading build artefacts — it shouldn't. No action is warranted if CI is within 30s.

- [ ] **Step 2: Measure on CI**

Inspect the runtime of the `pnpm nx run nestfolio-e2e:e2e` step in the first green CI run. The Playwright `webServer` orchestration logs each server's startup time. If total boot > 30s on CI, open an Issue and document — not a blocker for Phase 1.

### Task 10.2 — 10-consecutive-run stability bar

- [ ] **Step 1: Manually trigger 10 runs on main**

After Task 9.1 lands on main, use workflow_dispatch to re-run the e2e workflow 10 times consecutively (or wait for 10 nightly runs).

- [ ] **Step 2: Record the pass rate**

All 10 green → exit criterion met. If ≤ 1 flake across the 10, investigate the single failure; if retrying passes, log the exact failure mode (trace link) and leave a follow-up item in `project_e2e_feature_tests.md`. If ≥ 2 flakes, stability bar is not met — stop the Phase 1 ship and debug before declaring done.

### Task 10.3 — Verify spec §Acceptance criteria

Run through the spec's checklist (lines 419-428) and mark each:

- [ ] P1 (federation manifest) merged — Task 0.1 ✓
- [ ] P2 (serve-static port alignment) merged — Task 0.2 ✓
- [ ] P3 local-dev wiring applied (Option A: deployed CloudFront in env) — Task 4.1 + environment config
- [ ] `apps/nestfolio-e2e/` builds and lints clean — Task 3.2
- [ ] `pnpm nx run nestfolio-e2e:e2e` green locally cold — Task 8.1 Step 3
- [ ] `pnpm nx run nestfolio-e2e:e2e-ui` opens Playwright UI locally — Task 3.3 (verify manually: `pnpm nx run nestfolio-e2e:e2e-ui`; close the window)
- [ ] Six-server boot ≤ 15s local / ≤ 30s CI — Task 10.1
- [ ] `data-testid` attributes added to onboarding chat component + 7 renderer components + regression tests — Tasks 6.1–6.8
- [ ] `seedAmplifyTokens` post-seed assertion verified — Task 5.1 (`assertAmplifySessionAlive`)
- [ ] CI job wired with path-filter + nightly + on-demand, attaches report on failure — Task 9.1
- [ ] 10 consecutive main-branch runs green — Task 10.2

Tick each box only when the evidence exists. Do not self-certify.

### Task 10.4 — Wire the `copilotApiUrl` for the local e2e target

**Why:** Spec §P3 Option (A) points `copilotApiUrl` at the deployed sandbox CloudFront distribution for local Playwright runs. The current `environment.ts` (verified) sets `copilotApiUrl: 'http://localhost:4200/api/copilotkit'` — which `@nx/web:file-server` cannot serve.

**Files:**
- Modify: `apps/nestfolio-host/src/environments/environment.ts`
- Modify: `apps/nestfolio-e2e/project.json` (add `env` wiring if necessary)

- [ ] **Step 1: Read the deployed distribution URL at build time**

The cleanest option is to patch `environment.ts` to read an env var at build time, falling back to localhost for normal dev:

```ts
// apps/nestfolio-host/src/environments/environment.ts
const COPILOT_API_URL_DEFAULT = 'http://localhost:4200/api/copilotkit';

export const environment = {
  production: false,
  auth: {
    userPoolId: 'us-east-1_PLACEHOLDER',
    clientId: 'PLACEHOLDER_CLIENT_ID',
    region: 'us-east-1',
  },
  appsync: {
    /* unchanged */
  },
  copilotApiUrl: process.env['NF_COPILOT_API_URL'] ?? COPILOT_API_URL_DEFAULT,
};
```

This only runs at Angular *build* time (the `environment.ts` is compiled into the bundle), so the env var must be set for the `build` target when running under Playwright. Since `nestfolio-e2e:e2e` depends on the MFEs' `build` target via `dependsOn`, the env propagates if set in the shell before `pnpm nx run`.

- [ ] **Step 2: Document the one-time setup**

Add a single line to the top of `apps/nestfolio-e2e/playwright.config.ts` comment block:
```ts
// PRECONDITION: the deployed investor-web CloudFront distribution must exist
// in the `NESTFOLIO_INTEG_PREFIX` sandbox. To point the host build at it:
//   export NF_COPILOT_API_URL="$(aws ssm get-parameter --name /nestfolio/${NESTFOLIO_INTEG_PREFIX:-dev}-investor-web/web/distributionUrl --query Parameter.Value --output text)/api/copilotkit"
// Without this, /api/copilotkit 404s against @nx/web:file-server and step 4 hangs.
```

- [ ] **Step 3: Commit**

```bash
git add apps/nestfolio-host/src/environments/environment.ts apps/nestfolio-e2e/playwright.config.ts
git commit -m "feat(host): plumb NF_COPILOT_API_URL through dev environment for Playwright"
```

---

## Self-review checklist

Before declaring this plan done, cross-check against the spec:

- **Pre-work (P1, P2)** — Phase 0 Tasks 0.1, 0.2 ✓
- **P3 resolution (local-dev wiring)** — Phase 1 Task 1.2 (already shipped) + Phase 10 Task 10.4 (env plumbing)
- **Five open questions**:
  - Amplify localStorage key format spike → Task 1.1 ✓
  - CORS approach → Task 0.2 Step 3 / Task 1.2 (resolved via `cors: true`) ✓
  - `libs/e2e-fixtures` extraction → **not needed**; `@nestfolio/e2e-feature-tests` tsconfig alias already exists. Documented inline.
  - CI path-filter syntax → Task 1.5 + Task 9.1 ✓
  - `initiateDeposit` default state → Task 1.3 + optional Task 4.2 ✓
  - AuthStore refresh / step-5 UI-affordance gap (called out in spec §Phase 1 scenario note) → Task 1.4 + Task 2.1 ✓
- **Spec §Directory layout** — matches Phase 3/5/6/7 file creations ✓
- **Spec §Fixture design** — Phase 5 Tasks 5.1, 5.2 ✓ (note: the spec's example sketch imports `freshTenant` from `apps/e2e-feature-tests/src` — we use `@nestfolio/e2e-feature-tests` path alias which is equivalent and lint-clean)
- **Spec §POMs** — Phase 7 Tasks 7.1–7.5, one per MFE ✓
- **Spec §Phase 1 scenario steps 1–11** — Phase 8 Task 8.1 `test.step` blocks cover all 11 ✓
- **Spec §Playwright configuration** — Phase 3 Task 3.3 ✓
- **Spec §Nx target** — Phase 3 Task 3.2 ✓
- **Spec §Environment requirements** — documented in Task 8.1 Step 3 preconditions + CI job env ✓
- **Spec §CI trigger (path-filter + nightly + on-demand)** — Task 9.1 ✓
- **Spec §Rerun semantics (per-test fresh tenant, fixture teardown)** — Task 5.2 `tenant` fixture closes ctx in the teardown block ✓
- **Spec §Installation (@playwright/test; `playwright install chromium`)** — Task 3.1 ✓
- **Spec §Acceptance criteria (9 items)** — Task 10.3 maps 1:1 ✓
- **Non-goal: `apps/e2e-feature-tests/` untouched** — every task in this plan either creates new files under `apps/nestfolio-e2e/`, modifies `apps/nestfolio-host`/`*-mfe`, or extends `libs/test-support`. No task touches `apps/e2e-feature-tests/`. ✓

No placeholders remain. Every task lists exact file paths and shows the code or command an engineer needs.

---
