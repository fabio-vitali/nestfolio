# Playwright UI e2e — design

**Status:** Proposed
**Author:** fabio-vitali + Claude
**Date:** 2026-04-22

## Problem

The current e2e suite (`apps/e2e-feature-tests/`) exercises cross-domain behavior through GraphQL mutations and queries. It verifies backend correctness but says nothing about whether the frontend surfaces the resulting state to the user. A GraphQL-passes + UI-broken state is still a shipped bug.

A per-feature UI mirror of the existing Jest scenarios would add mostly duplicative signal (service integration tests + the Jest e2e layer already cover feature-level contracts). What UI e2e uniquely gives is **how features compose in realistic sequences** — navigation between MFEs, state accumulation across a session, real user workflows spanning many steps.

We stand up Playwright with long-journey scenarios that exercise many features on a single tenant, in the order a real user would.

## Goals

- Stand up Playwright as a first-class e2e harness in the Nx monorepo.
- Ship one canonical long journey — `new-investor-happy-path` — exercising every MFE and the major state transitions a new user experiences end-to-end.
- Establish reusable fixtures (tenant, authenticated page, POM conventions) that future journeys and future reliability scenarios will reuse.
- Leave the existing Jest suite (`apps/e2e-feature-tests/`) untouched as per-feature contract coverage.

## Non-goals

- Touching, modifying, or planning deletion of `apps/e2e-feature-tests/`. Both suites coexist indefinitely. Cleanup is user-triggered at a future date and is explicitly out of scope for this spec and any implementation plan derived from it.
- Per-feature UI mirrors of the 15 Jest scenarios. Features are exercised inside journeys.
- Reliability / failure-branch scenarios in Phase 1 (timeout, retry, network interruption). These are a separate future spec.
- A citations UX on onboarding. Reserved for a separate Phase 2 brainstorm.
- Testing KB retrieval **quality**. Only KB **interaction** (agent invokes it, call succeeds).
- Testing the login UI as a recurring concern. Auth is seeded programmatically.

## High-level decisions (locked)

| Decision | Choice |
|----------|--------|
| Backend target | Real AWS sandbox. Reuse `@nestfolio/test-support` (`CognitoFixture`, `TestContext`) via `freshTenant` helper in `apps/e2e-feature-tests/src`. |
| Project layout | New Nx app `apps/nestfolio-e2e/`. Sibling to `apps/e2e-feature-tests/`. Structured around **journeys**, not features. |
| Auth | Programmatic Cognito via `CognitoFixture.setup()`; tokens seeded into Amplify's localStorage keys via `page.addInitScript()` before navigation. |
| Tenant scope | Per-test `freshTenant`. Journeys start un-onboarded and accumulate real state across features — worker-scoped sharing is counterproductive for this pattern. (Worker-scoped fixture left as future option if reliability specs need it.) |
| Frontend serve | Build-once + **per-MFE static servers** via each app's existing `nx run <app>:serve-static` target (`@nx/web:file-server` with `spa: true`). Distinct origins, orchestrated by Playwright's multi-`webServer` config. Exercises Native Federation's cross-origin remote-loading in every test run. |
| Browsers | Chromium only in Phase 1. |
| Assertion rule | UI-only by default. Observability (trace envelope) is a narrow, named exception. GraphQL assertions are prohibited in `nestfolio-e2e`. |
| CI trigger | **Path-filter**, not `nx affected`. `affected` doesn't model UI↔backend edges correctly across this repo. Full e2e suite runs on any PR touching frontend or BFF paths, plus a nightly full-suite run. |

## Pre-work — prerequisite fixes in existing code

Discovered during spec review on `main`. These must be merged before Phase 1 e2e runs. They are **not caused by this work**; they are pre-existing defects that block any multi-MFE harness:

### P1. `onboarding-mfe` is missing from the federation manifest

`apps/nestfolio-host/public/assets/federation.manifest.json` lists only investor, dashboard, advisory, ledger (verified on `main` — 4 entries). `apps/nestfolio-host/src/main.ts` bootstraps via `initFederation('/assets/federation.manifest.json')` and `app.routes.ts` references `loadRemoteModule('onboarding-mfe', './routes')` which at runtime falls through to `MfeErrorComponent`. **Onboarding is not reachable via the host on main.**

Fix: add `"onboarding-mfe": "http://localhost:4205/remoteEntry.json"` (dev value) to the manifest. Production manifest is generated separately and is out of scope.

### P2. `serve-static` port collisions

Current ports in `project.json` files:

| App | `serve-static` port | Manifest port | Status |
|-----|---------------------|---------------|--------|
| nestfolio-host | 4200 | — | ✓ |
| investor-mfe | 4201 | 4201 | ✓ |
| dashboard-mfe | **4201** | 4202 | **collision with investor; misaligned with manifest** |
| advisory-mfe | **4202** | 4203 | **collision with manifest-dashboard; misaligned with manifest** |
| ledger-mfe | 4204 | 4204 | ✓ |
| onboarding-mfe | 4205 | (missing, see P1) | ✓ after P1 |

Fix: align `serve-static` ports to the manifest — set dashboard-mfe to 4202, advisory-mfe to 4203.

Note: the dev `serve` (Angular dev-server) target on dashboard-mfe and advisory-mfe has the same collision (4201 / 4202). It does not affect this harness (we use `serve-static` only), but a developer running `nx serve` on those MFEs hits the same broken state. Fixing it is cheap and correct — recommend bundling with the `serve-static` fix so both targets agree with the manifest.

### P3. Onboarding agent bridge — shipped; local-dev wiring is the remaining gap

**Update 2026-04-22 post-review:** the production bridge from the browser to the onboarding AgentCore runtime has already shipped. `services/investor/investor-web/src/service.stack.ts:132-201` attaches a `/api/copilotkit*` cache behavior to the investor-web CloudFront distribution, with a viewer-request CloudFront Function (`src/cf-functions/copilot-rewrite.js`) that rewrites the URI to `/runtimes/<arn>/invocations?qualifier=DEFAULT`. Cognito JWT auth is enforced natively by AgentCore (`feat(onboarding-bff): enable Cognito authorizer on AgentCore runtime`, commit `afd05a36`). The onboarding MFE consumes the bridge via the `COPILOT_API_URL` DI token resolved at boot from `RuntimeConfig.copilotApiUrl` (`apps/nestfolio-host/src/app/app.config.ts:88-91`) — **no hardcoded `/api/copilotkit` path remains in `onboarding-chat.component.ts`**. The companion design lives in `docs/superpowers/specs/2026-04-22-onboarding-agentcore-bridge-design.md`.

What this means for Phase 1:

- **Production / deployed sandbox: resolved.** Any browser hitting the deployed CloudFront distribution already has a working end-to-end CopilotKit path.
- **Local dev (what Playwright runs against by default): still broken.** `apps/nestfolio-host/src/environments/environment.ts:26` sets `copilotApiUrl: 'http://localhost:4200/api/copilotkit'`, and `@nx/web:file-server` on 4200 is a static server with no proxy capability. Hitting that path returns 404.

Plan must pick **one** of the following for local Playwright runs (design-level decision, but both are small):

- **(A) Point `copilotApiUrl` at the deployed sandbox CloudFront distribution.** The same CORS policy at `service.stack.ts:177-192` already allowlists `http://localhost:4200`. Zero new code; the e2e run hits the real bridge. Cost: requires the investor-web stack to be deployed in the sandbox prefix the e2e job targets.
- **(B) Run a tiny dev reverse-proxy alongside Playwright's `webServer` array.** Forwards `http://localhost:4200/api/copilotkit*` to the deployed AgentCore endpoint (reading the SSM-exported runtime ARN), signing Cognito JWT forwards 1:1. Replicates CloudFront locally. Cost: one small process to maintain.

Recommendation: **(A)** — it exercises the real production path and the CORS policy. Keeps Playwright config identical to production wire shape.

This is a **plan-level** wiring decision, not pre-work. P3 as originally framed (build a Lambda bridge) is obsolete.

### Canonical post-fix port table

After P1 and P2, the layout is:

| Origin | App |
|--------|-----|
| http://localhost:4200 | nestfolio-host |
| http://localhost:4201 | investor-mfe |
| http://localhost:4202 | dashboard-mfe |
| http://localhost:4203 | advisory-mfe |
| http://localhost:4204 | ledger-mfe |
| http://localhost:4205 | onboarding-mfe |

These are the ports the Playwright `webServer` array and the federation manifest must agree on.

## Architecture

### Directory layout

```
apps/nestfolio-e2e/
├── playwright.config.ts
├── project.json
├── tsconfig.json
└── src/
    ├── fixtures/
    │   ├── test.ts               # extended `test` composing fixtures
    │   └── tenant.fixture.ts     # createCtx, seedAmplifyTokens
    ├── pages/                    # POMs per MFE, grown as the journey needs
    │   ├── onboarding.page.ts
    │   ├── dashboard.page.ts
    │   ├── investor.page.ts
    │   ├── advisory.page.ts
    │   └── ledger.page.ts
    └── journeys/
        └── new-investor-happy-path.spec.ts
```

Features are not a folder dimension. Future `circuit-breaker-lifecycle.spec.ts` / `active-investor-adjustments.spec.ts` live alongside the happy journey in `journeys/`.

### Fixture design

Per-test fresh tenant. Simple, small surface.

```ts
// apps/nestfolio-e2e/src/fixtures/test.ts (sketch)
import { test as base } from '@playwright/test';
import { createTestContext, type TestContext } from '@nestfolio/test-support';
import { freshTenant, type FreshTenant } from '../../../e2e-feature-tests/src';

interface Fx {
  tenant: { ctx: TestContext; tenant: FreshTenant };
  authedPage: import('@playwright/test').Page;
}

export const test = base.extend<Fx>({
  tenant: async ({}, use) => {
    const ctx = await createTestContext();
    const t = await freshTenant(ctx);
    await use({ ctx, tenant: t });
    await ctx.cleanup.runAll();
  },

  authedPage: async ({ page, tenant }, use) => {
    await seedAmplifyTokens(page, tenant.tenant.cognitoTokens);
    await use(page);
  },
});
export { expect } from '@playwright/test';
```

`seedAmplifyTokens(page, tokens)` uses `page.addInitScript()` to write Amplify v6's localStorage keys (client-id + username-scoped ID/access/refresh tokens) before navigation, so the shell's `fetchAuthSession()` returns the test identity without touching `/login`.

**Plan-level fragility**: Amplify v6's exact localStorage key format is version-specific and not stable across minor versions. The plan must spike the exact format once against a live Amplify session and codify it in `seedAmplifyTokens`. Silent failure mode (seeds wrong keys → fixture thinks it seeded → `fetchAuthSession()` returns null → redirect to `/login`) is easy to introduce; plan must add an assertion that `fetchAuthSession()` returns non-null after seeding, run pre-journey.

**Shared-helper note**: the fixture imports `freshTenant` from `apps/e2e-feature-tests/src`. The plan will evaluate extracting into a `libs/e2e-fixtures` library based on tsconfig-alias friction. Design-level decision deferred — both options work.

### Page Object Models

One POM per MFE. Scenario specs never touch raw locators. Intent-level methods:

```ts
// apps/nestfolio-e2e/src/pages/onboarding.page.ts (sketch)
export class OnboardingChatPage {
  constructor(readonly page: Page) {}

  goto()                             { return this.page.goto('/onboarding'); }
  waitForRenderer(tool: RendererTool, timeout = 30_000) {
    return this.page.getByTestId(`renderer-${tool}`).first().waitFor({ timeout });
  }
  selectOption(value: string)        { return this.page.getByTestId(`option-${value}`).click(); }
  selectMode(m: OperatingMode)       { return this.page.getByTestId(`mode-${m}`).click(); }
  setSlider(v: number): Promise<void>;
  setAmountCents(v: number): Promise<void>;
  confirmSummary()                   { return this.page.getByTestId('summary-confirm').click(); }
  grantConsent()                     { return this.page.getByTestId('consent-accept').click(); }
  clickCta()                         { return this.page.getByTestId('cta-primary').click(); }
  sendMessage(text: string): Promise<void>;
  phaseIndex(): Promise<number>;
  activeRenderer(): Promise<RendererTool | null>;
  waitForAssistantReply(timeout?: number): Promise<void>;
}
```

Adding `data-testid` attributes to `apps/onboarding-mfe/src/app/onboarding/onboarding-chat.component.ts` (verified: `totalPhases = signal(7)` in the component — 7 phases indexed 0–6) and each of the seven renderer components (`options`, `mode-cards`, `slider`, `amount`, `summary`, `consent`, `cta`) is in-scope for the Phase 1 bring-up. CSS-class selectors are too brittle for this harness.

Additional POMs (`DashboardPage`, `InvestorPage`, `AdvisoryPage`, `LedgerPage`) grow only the methods the Phase 1 journey needs. Each method added earns its place by being used in a journey.

**Survey results (2026-04-22, re-audited post-review)**:

| Step | Affordance | Status | Source |
|------|------------|--------|--------|
| 7 | Fund-account page (investor MFE) | **PRESENT** — `DepositPageComponent` ships full state machine (`form` → `submitting` → `initiated` → `detected` / `timeout` / `failed`) with `data-testid` attributes already in place (`deposit-form`, `deposit-amount`, `deposit-confirm`, `deposit-panel-detected`, …). Dashboard has a `Deposit CTA on cash-balance KPI` entry point. | `apps/investor-mfe/src/app/deposit/deposit-page.component.ts`, commits `3b3c1bfa`, `97e5c06e`, `c58a05c9` |
| 8 | Per-decision "pending" card on dashboard | **PARTIAL** — `AdvisoryAlertBarComponent` shows a `pendingDecisionsCount` counter + CTA; no per-decision card. Step assertion reformulated: counter advances from 0 → ≥1 | `dashboard-mfe/src/app/dashboard/advisory-alert-bar.component.ts` |
| 9 | Explanation panel (advisory) | **PRESENT** — `decision.rationale` rendered inline in decision-detail | `advisory-mfe/src/app/decision/decision-detail.component.ts:68-70` |
| 10 | Accept control (advisory) | **PRESENT** — `confirm` + `reject` p-buttons; reject opens a dialog with reason input | `advisory-mfe/src/app/decision/decision-detail.component.ts:74-122` |
| 11 | Logout control (host) | **PRESENT** — `LogoutButtonComponent` (with `data-testid="cta-logout"`) is projected into `ShellLayoutComponent` via the `[nfHeaderActions]` named slot from `app.component.ts`; gated by `authStore.status() === 'authenticated'`. | `libs/shell/src/components/logout-button.component.ts`, `apps/nestfolio-host/src/app/app.component.ts`, commits `2e2b5c89`…`975105aa` |

Consequences for Phase 1: steps 7, 9, 10, 11 are wire-able with at most minor `data-testid` additions — no net-new feature work is required. Step 8's assertion is downgraded to the counter.

### Assertion rule

- **Default: UI assertions.** `expect(locator).toBeVisible()` / `toHaveText()`. Playwright's auto-wait handles async backend propagation (EB → CDC → BFF projection → UI render) natively.
- **Named exception: observability assertions** for server-side plumbing with no UI surface. Uses `AgentTraceTrap` from `apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts` unchanged. Only the KB interaction step uses this in Phase 1, and it is marked transitional — expected to migrate to a UI assertion once Phase 2 citations ship.
- **Prohibited: GraphQL assertions.** If a journey step reaches for the BFF client, the step belongs in `e2e-feature-tests` or in the owning service's integration test.

### LLM-determinism strategy

The onboarding agent (LangGraph + Bedrock Sonnet) produces non-deterministic text. Tests never assert on chat-bubble text. They assert on:

1. **Renderer appearance** — the tool name mounted (`renderer-render_mode_cards`) proves the agent reached that phase and chose the expected tool.
2. **Renderer structural args** — option values (`option-AGGRESSIVE`) are part of the graph contract.
3. **Phase transitions** — `phaseIndex` advances monotonically 0→6.
4. **UI-visible outcomes after the wizard** — redirect to `/dashboard`, dashboard content, mandate chip.

LLM source: real Bedrock in Phase 1. The FakeLlm toggle planned in `project_mock_resilience.md` drops in later via env var with no test changes.

## Phase 1 scenario — `new-investor-happy-path`

One journey, exercising every MFE and the major state transitions a new investor experiences.

### Steps

| # | Step | MFE | Assertion kind | What it covers |
|---|------|-----|----------------|-----------------|
| 1 | Arm `AgentTraceTrap` for `'onboarding'`; seed authenticated session for a fresh un-onboarded tenant | — | (setup) | Fixture: `CognitoFixture` → Amplify localStorage seeded; `fetchAuthSession()` returns tokens pre-navigation |
| 2 | `goto('/onboarding')` — shell routes to onboarding-mfe | host + onboarding | UI (URL stabilizes at `/onboarding`; `renderer-*` appears) | Auth guard passes; `onboardingPendingGuard` admits; Native Federation resolves `onboarding-mfe` and loads its `remoteEntry.json` |
| 3 | Walk the first five renderer phases (options → mode-cards → slider → amount → summary) | onboarding | UI (each renderer mounts in sequence; `phaseIndex` advances 0→4 — the signal is 0-based, displayed as "N+1 di 7" in the progress bar) | Agent graph integrity; renderer contracts; tool-renderer map |
| 4 | Mid-wizard: ask one product question (e.g. "Come funziona il rebalancing?") | onboarding | **UI** (assistant reply appears) + **observability** (`AgentTraceTrap` sees `search_knowledge_base` succeed) | KB plumbing end-to-end. Observability assertion is **transitional**, migrates to UI citations in Phase 3. |
| 5 | Complete the last two phases: consent + CTA | onboarding | UI (`phaseIndex` advances 5 → 6 — the final index; URL redirects to `/dashboard`) | `onboardingCompletedGuard` admits (reads `AuthStore.user().onboardingCompletedAt`) — see AuthStore-refresh assumption below |
| 6 | Dashboard renders post-onboarded shell | dashboard | UI (dashboard cards visible; mandate-active indicator) | Post-onboarding projection reached BFF; UI reads it |
| 7 | From dashboard's Deposit CTA → `/deposit` → enter amount → Confirm; wait for `DETECTED` panel | investor | UI (`deposit-form` visible → `deposit-panel-initiated` → `deposit-panel-detected`) | Deposit JS-resolver → EB → investor-bff projection → AppSync subscription → UI state machine. Covers `initiateDeposit` feature-flag gating (flag must be enabled for the confirm button to activate — plan verifies fixture state). |
| 8 | Wait for the dashboard pending-decisions counter to advance | dashboard | UI (`AdvisoryAlertBarComponent` counter `0 → ≥1`) | Deposit detection (or, as fallback, onboarding completion) triggers the advisory pipeline; decision-workflow SF → agents → BFF projection → dashboard counter |
| 9 | Navigate to `/advisory/:id` and read the rationale | advisory | UI (`decision.rationale` text visible on the detail page) | advisory-narrative agent output reached UI |
| 10 | Accept (Confirm) the decision | advisory | UI (decision moves to Accepted state; allocation reflected on dashboard) | Confirm handler → ledger → projection → UI. Uses existing `p-button` in `decision-detail.component.ts` |
| 11 | Click `[data-testid="cta-logout"]` in shell header → URL settles at `/login` and `authStore.status() === 'unauthenticated'` | host | UI (redirect to `/login`; logout button disappears from header) | `LogoutButtonComponent.logout()` — Amplify sign-out + auth-store reset + router navigate, all with a fail-safe fallback path |

The journey is one spec file. Each step uses Playwright's `test.step('...')` so failures pin to a labeled step and traces are navigable.

**AuthStore-refresh assumption (step 5):** `onboardingCompletedGuard` reads `AuthStore.user().onboardingCompletedAt`, which is set once at boot by `initializeAuth()` → `getAuthUser()` (see `apps/nestfolio-host/src/app/app.config.ts`). A Cognito ID token is not automatically refreshed when the backend writes `onboardingCompletedAt`; the guard will therefore reject the nav to `/dashboard` unless the app either (a) explicitly refreshes the session on onboarding completion, (b) updates `AuthStore` directly from the completion event, or (c) the journey tolerates a hard reload before step 6. The plan survey must confirm which of these the host does today; if none, step 5 is blocked behind a shell-side fix.

### KB interaction — transitional observability step

Step 4 uses `AgentTraceTrap.arm(ctx, 'onboarding')` (armed in **step 1 — must precede any UI action that can invoke the agent**) to collect `ONBOARDING_AGENT_INVOCATION_TRACED` envelopes on investorBus. Asserts:

- `toolCalls[].toolName === 'search_knowledge_base'` present.
- `status === 'success'`.
- `argKeys` contains `query`.

No assertion on retrieval text or result quality.

This assertion is **transitional**. Phase 2 (separate brainstorm) adds a citations UX: `search-kb.handler.ts` returns `{ text, citations[] }` (data already available in `RetrieveAndGenerateCommand` response, currently discarded), the agent calls a new `render_citations` tool, and a `CitationsRendererComponent` is added to the existing `TOOL_RENDERER_MAP`. Phase 3 replaces the trace-envelope assertion in step 4 with a UI assertion on the citations renderer.

CopilotKit does not ship a citations component; Phase 2 follows the existing tool-renderer pattern already used by the seven onboarding renderers.

## Playwright configuration

```ts
// apps/nestfolio-e2e/playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

const HOST_URL = 'http://localhost:4200';

export default defineConfig({
  testDir: './src',
  testMatch: '**/*.spec.ts',
  // `fullyParallel` is a no-op while `workers: 1`; left truthy so that raising
  // `workers` later (when journeys multiply) parallelises automatically.
  fullyParallel: true,
  workers: 1,                   // Phase 1 has one spec; expand when journeys multiply
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'reports/html' }], ['junit', { outputFile: 'reports/junit.xml' }]]
    : 'list',
  timeout: 600_000,             // per test; a full journey is long
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
    mfeServer('nestfolio-host',  4200),
    mfeServer('investor-mfe',    4201),
    mfeServer('dashboard-mfe',   4202),
    mfeServer('advisory-mfe',    4203),
    mfeServer('ledger-mfe',      4204),
    mfeServer('onboarding-mfe',  4205),
  ],
  outputDir: 'test-results',
});

function mfeServer(app: string, port: number) {
  return {
    command: `pnpm nx run ${app}:serve-static`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe' as const,
    stderr: 'pipe' as const,
  };
}
```

### Federation serving — locked

Native Federation is a **core design component** of the architecture — the existing `MfeErrorComponent` (`apps/nestfolio-host/src/app/app.routes.ts`, wrapping every `loadRemoteModule(...).catch(...)`) is direct evidence that federation loading is a known failure surface. Testing against a same-origin convenience layout would silently skip that surface. Every Phase 1 run exercises real cross-origin remote loading.

**Layout:**

- Host shell on `http://localhost:4200`.
- Each MFE on its own port (4201–4205) matching the federation manifest after P1/P2.
- Each server is `nx run <app>:serve-static` — uses `@nx/web:file-server` with `spa: true` (already configured in each project), which correctly serves `index.html` for unknown routes (needed for Angular router).
- `reuseExistingServer: !CI` — locally, run all six via `nx run-many --target=serve-static --parallel=6` in one terminal, iterate specs in another without restart churn.

**CORS — required, not optional**: `@nx/web:file-server` (backed by `http-server` internally) does not enable CORS by default. Every MFE's static server must emit `Access-Control-Allow-Origin: http://localhost:4200` (or `*` for dev), or the host's `loadRemoteModule()` call will fail on the cross-origin `remoteEntry.json` fetch and fall through to `MfeErrorComponent`. The plan must either: (a) pass `--cors` through the `@nx/web:file-server` options if the executor surfaces the underlying `http-server` flags, or (b) add a tiny CORS-enabling wrapper target. This is a prerequisite, not a "verify if needed" step.

**What this catches that a single-server layout wouldn't:**

- Federation config drift between host and MFE (`federation.config.js` or manifest stale).
- CORS misconfigs on any MFE's static assets.
- Remote-entry URL resolution bugs.
- Version / sharedScope mismatches in `remoteEntry.json`.

**Plan-level plumbing:**

- Ports 4200–4205 must be free at test start. A pre-flight port-check in the e2e target fails fast with a clear message if one is taken.
- Cold-start cost: ~8–10s for six servers vs ~3s for one. Acceptable per-run; amortized away locally by `reuseExistingServer`.

## Nx target

```jsonc
// apps/nestfolio-e2e/project.json
{
  "name": "nestfolio-e2e",
  "sourceRoot": "apps/nestfolio-e2e/src",
  "projectType": "application",
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
      "options": { "command": "pnpm exec playwright test --config apps/nestfolio-e2e/playwright.config.ts --ui" }
    },
    "lint": { "executor": "@nx/eslint:lint" }
  },
  "tags": ["scope:platform", "type:app"]
}
```

- `dependsOn` keeps host + MFE dists current; Nx cache keeps repeat runs fast.
- `e2e-ui` exposes Playwright's interactive UI mode for local debugging.

## Environment requirements

The harness inherits env requirements from `@nestfolio/test-support` and the existing Jest e2e. Plan documents the full list in the e2e target's `env` block; at minimum:

- `AWS_REGION` — `us-east-1`.
- Valid AWS credentials (sandbox account `771924376645` via Leapp/AdminRole locally; OIDC-assumed role in CI).
- `NESTFOLIO_INTEG_PREFIX` — `dev` (Phase 1). Drives `freshTenant`'s `integ-` → `e2e-` rewrite.
- Cognito pool ID + app client ID — read by `CognitoFixture` from the same SSM paths or env vars the Jest e2e already resolves.
- `KNOWLEDGE_BASE_ID` is service-side only (not needed in the harness).

No new secrets. All values are already consumed by `e2e-feature-tests` today.

## CI trigger

`nx affected` does **not** apply. It cannot see the UI↔backend edges that e2e exercises, and forcing declared edges pollutes every other `affected` decision in the repo.

Rules:

- **PR trigger** — path-filter on frontend paths (`apps/*-mfe/**`, `apps/nestfolio-host/**`, `libs/shell/**`, `libs/ui/**`) and on BFF paths (any `services/**/` directory ending in `-bff`). Any match runs the full e2e suite.
- **Nightly** — full e2e suite runs unconditionally against the sandbox to catch backend-only regressions.
- **On-demand** — a `/run-e2e` PR comment (or workflow_dispatch button) forces the suite regardless of path filter.

Exact path-filter syntax is CI-engine-specific (`paths:` in GitHub Actions vs `only:changes:` in GitLab vs patterns in other tools). Plan picks the syntax to match `project_ci_pipeline.md`.

Artifacts on failure: `reports/html`, `reports/junit.xml`, `test-results/` (traces, screenshots, video).

## Rerun semantics

Each journey run is fully independent:

- No cross-run state. Every run provisions a new Cognito user + tenant.
- Fixture teardown (`ctx.cleanup.runAll()`) removes the Cognito user and any tenant-scoped DDB items that `@nestfolio/test-support` knows about.
- A failing run leaves behind trace/video/screenshot artifacts and (briefly, on timeout) a partially-cleaned tenant. The memory entry `project_e2e_feature_tests.md` and the existing Jest `jest.global-teardown.ts` document the reconciliation job that sweeps orphans — same applies here.
- No retry logic mid-journey. A step failure terminates the run. Playwright's `retries: 1` on CI retries the whole journey.

## Installation

New dev dependencies at workspace root:

- `@playwright/test`
- No new static-server dep (reuses existing `@nx/web:file-server` via project targets).

One-time browser install in dev and CI: `pnpm exec playwright install chromium`.

## Acceptance criteria — "Phase 1 ships when"

- [ ] P1 (federation manifest) and P2 (serve-static port alignment) prerequisite fixes merged on `main`. P3 (CopilotKit bridge) is already shipped; the local-dev wiring choice from §P3 (recommended: point `copilotApiUrl` at the deployed sandbox CloudFront URL) is applied to the e2e target's env block.
- [ ] `apps/nestfolio-e2e/` builds and lints clean.
- [ ] `pnpm nx run nestfolio-e2e:e2e` green locally end-to-end with a cold cache.
- [ ] `pnpm nx run nestfolio-e2e:e2e-ui` opens Playwright's interactive UI locally.
- [ ] Six-server boot completes in ≤ 15s (allowed CI ceiling: 30s).
- [ ] `data-testid` attributes added to the onboarding chat component and its 7 renderer components; a targeted unit test prevents regressions.
- [ ] `seedAmplifyTokens` verified via a post-seeding assertion that `fetchAuthSession()` returns non-null.
- [ ] CI job wired with path-filter + nightly + on-demand triggers. Failing CI attaches HTML report + traces.
- [ ] Journey green on CI across 10 consecutive main-branch runs (stability bar).

## Future scenarios (not in this spec)

Listed so their shape informs the Phase 1 fixture + POM design, but not in Phase 1 scope:

- `circuit-breaker-lifecycle` — onboarded tenant → decision pending → CB trips → UI halted → heal → resume.
- `active-investor-adjustments` — onboarded tenant → update goal → drift → rebalance decision → reject → update mandate → revoke → request closure.
- Reliability scenarios — timeout/retry, network interruption, session resume across tab close. Own spec.
- Citations feature (Phase 2) + migration of step 4's assertion to UI (Phase 3). Own spec.

## Open questions / plan-level decisions

- Local-dev wiring for the CopilotKit bridge (see §P3): pick option (A) deployed CloudFront URL or (B) a dev reverse-proxy. Recommendation: (A).
- Whether to extract `freshTenant` into a `libs/e2e-fixtures` shared library or cross-app import from `apps/e2e-feature-tests/src`. Decide based on tsconfig-alias friction during plan execution.
- Exact Amplify v6 localStorage key format (plan spike + seeding assertion).
- Whether `@nx/web:file-server` needs a CORS-enabling patch or a small custom wrapper.
- Exact CI path-filter syntax (engine-specific; derive from `project_ci_pipeline.md`).
- Step 7 depends on the `initiateDeposit` feature flag being enabled for the e2e tenant. Plan confirms the default state (flag-service initial value) and, if it is off by default, adds a fixture that flips the flag to `true` for each journey run (pattern: mutation against advisory-bff's feature-flag resolver, already used by the CB integration suite).

## References

- Playwright fixtures docs: https://playwright.dev/docs/test-fixtures
- Playwright auth docs: https://playwright.dev/docs/auth
- Existing e2e suite: `apps/e2e-feature-tests/`
- Shared test support: `@nestfolio/test-support`
- Onboarding chat component: `apps/onboarding-mfe/src/app/onboarding/onboarding-chat.component.ts` (7-phase wizard confirmed: `totalPhases = signal(7)`; consumes `COPILOT_API_URL` DI token — no hardcoded path)
- Onboarding KB tool: `services/investor/onboarding-bff/src/agent/tools/search-kb.handler.ts`
- Agent trace envelope: `libs/agent-orchestrator/src/agent-tracer.ts`
- Trace trap helper: `apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts`
- Federation manifest: `apps/nestfolio-host/public/assets/federation.manifest.json`
- Onboarding AgentCore bridge (companion design, shipped): `docs/superpowers/specs/2026-04-22-onboarding-agentcore-bridge-design.md`; CloudFront behavior wired in `services/investor/investor-web/src/service.stack.ts:132-201`
- Deposit flow (step 7): `apps/investor-mfe/src/app/deposit/deposit-page.component.ts`
- Logout control (step 11): `libs/shell/src/components/logout-button.component.ts`, projected by `apps/nestfolio-host/src/app/app.component.ts`
