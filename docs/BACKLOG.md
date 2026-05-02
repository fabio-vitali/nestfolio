# Nestfolio Backlog

**Single source of truth for what to do next.** Three sections, in priority order.

**Discipline:**
- **One ACTIVE workstream at a time.** Anything else is QUEUED or PARKING LOT.
- **File-and-continue.** When a side-finding surfaces during execution, drop a one-liner into PARKING LOT (or the relevant topic memory) and continue the active workstream. Do not pivot mid-flight.
- **Scope contract.** Every spec/plan must have an explicit §"Out of scope" before execution starts. Out-of-scope failures during validation default to *file-and-continue*, not pivot.
- **Boundary review.** At each workstream ship, spend 5 min re-ranking PARKING LOT and promoting items to QUEUED if they've grown teeth.

Last reviewed: 2026-05-02 (after Spec 5 ship — decision-update broadcast pipeline operational).
Updated 2026-05-02: Spec 5 partial-ship. Step 10 (Confirm button → WSS broadcast) demonstrably resolved by `feat/decision-broadcast`; Step 9 (decision-list empty on first query) is a separate timing issue, refiled in QUEUED.

---

## ACTIVE

### `[e2e]` Journey Step 9 — decision-list empty on first query (timing race)

Plan: `docs/superpowers/plans/2026-05-02-decision-list-pattern-b.md`. Promoted from QUEUED 2026-05-02 — see same entry below for the full mechanism + fix prescription.

---

## QUEUED

Ordered by priority. Top of list = what to start next.

### `[e2e]` Journey Step 9 — decision-list empty on first query (timing race)

**Done when:** `goToFirstPendingDecision()` finds a decision link reliably (5/5 runs) without extending the 15s POM timeout, and the decision-list page recovers if the row arrives after first query.

**Status:** Surfaced 2026-05-02 during Spec 5 validation gate. Spec 5's broadcast pipeline (Step 10) is shipping clean — the remaining failure is upstream of the broadcast. Per `feedback_e2e_ui_assertions_only.md`: a 15s wait is more than a real user would tolerate; the UI/projection is the bug, not the test.

**Concrete failure:** `apps/nestfolio-e2e/src/pages/advisory.page.ts:20` — `goToFirstPendingDecision()` navigates to `/advisory`, waits ≤15s for `a[data-testid^="decision-"]`. Page snapshot at timeout: `heading "advisory.list.emptyTitle"`. The decision row exists in `dev-advisory-bff-StateTable` with `status: AWAITING_CONFIRMATION` matching the e2e tenant — confirmed by direct DDB scan post-failure.

**Mechanism (verified during Spec 5 e2e Run 1-redo, fresh-1, fresh-2):** `decision-list.component.ts:132` calls `getPendingDecisions` ONCE on init (no subscription, no polling). If the agent pipeline hasn't materialised the row at the moment the user lands on `/advisory`, the page renders empty state forever. Step 8's dashboard counter materialises ~30s before advisory-bff's row appears, so Step 8 passing isn't a sufficient barrier for Step 9.

**Fix:** apply Pattern B on decision-list — subscribe to `onDecisionUpdate(tenantId)` in `decision-list.component.ts:ngOnInit`, unsubscribe in `ngOnDestroy`, run `getPendingDecisions` alongside (the query hydrates whatever already exists; the subscription delivers everything that arrives after). Frame handler reconciles by `decisionId`: not present → prepend; present → update in place; new status falls outside the pending set → remove. No version-guard race-prevention needed (R1) the way `decision-detail` needed it — for a tenant-scoped list, INSERT events are additive and arrive monotonically; MODIFY events naturally land after the query's snapshot regardless of order. The advisory-bff broadcast pipeline shipped in Spec 5 already emits both INSERT and MODIFY events, so the wire is ready.

**Why no other options are listed:**
- Polling fallback is off the table per `feedback_e2e_ui_assertions_only.md` — we use subscriptions, and we e2e-assert subscription-driven re-rendering.
- "Tighten upstream materialisation latency" is wrong-premise — the system is eventually consistent by design. Reducing latency cannot eliminate the race; the only correct response is to make the UI react to events that arrive after the initial query, which is exactly Pattern B.

**Topic memory:** `project_playwright_e2e_ui.md` (Step 9 timing); `project_decision_workflow_stuck.md`.

---

### `[e2e]` Journey Step 8 — WSS dashboard subscription bug

**Done when:** `injectAdvisoryUpdate` sentinel value reliably appears in the dashboard counter via the live WSS subscription path.

**Status:** Pre-existing. Spec 3 surfaced new evidence that supersedes 6th-session "WSS subscription never opens" diagnosis: subscription IS attached and DELIVERS frames (30 `apollo next domain=dashboard` events on Run 1), but the inject's specific value isn't arriving in the counter. Failure mechanism is different from what 6th-session assumed.

**Hypotheses (none verified):**
- Inject mutation and dashboard subscription target different AppSync APIs.
- Inject's broadcast may arrive with `advisoryStatus: null` (resolver returns `?? null`; subscriber gates on `if (advisoryStatus)`).
- Auth-mode interaction between IAM-published mutation and Cognito subscriber.

**Cheapest next step:** add console logging of actual `pendingDecisionsCount` values delivered to `dashboard-container.component.ts:178`, rebuild + re-run e2e once, inspect.

**Topic memory:** `project_playwright_e2e_ui.md` (search "Side-finding from Spec 3 e2e gate").

---

### `[design]` Operating mode feature

**Status:** DESIGN IN PROGRESS (2026-04-14). Captured at onboarding but not wired into advisory behavior.

**Done when:** AGGRESSIVE/BALANCED/CONSERVATIVE actually drives portfolio-engine + advisory-narrative behavior.

**Topic memory:** `project_operating_mode.md`.

---

### `[design]` Integration test mock resilience

**Status:** DESIGN IN PROGRESS (2026-04-16). FakeLlm via env var in agent-factory; StateResetFixture for stale state; SsmOverride verification.

**Topic memory:** `project_mock_resilience.md`.

---

### `[infra]` PR pipeline integration tests

**Status:** Specs/plans done; implementation pending (2026-04-10).

**Topic memory:** `project_ci_pipeline.md`.

---

### `[feature]` Remaining agent orchestrators (3 of 5)

**Status:** 2/5 done; 3 remaining.

**Topic memory:** `project_agent_orchestrators.md`.

---

## PARKING LOT

One-liners for things surfaced but not yet adopted as a workstream. Promote to QUEUED when teeth grow.

- **`OnboardingRepository.updatePhase` ValidationException on non-mandate commits** — latent backend bug; non-blocking for onboarding e2e per Spec 3 ship.
- **BFF resolver region sweep** — advisory-bff + ledger-bff mutation resolvers likely missing `region` field.
- **C4 frontend representation** — MFEs in C4 diagrams at C1 + C2 level (planned, not started).
- **Unified Ingress refactoring** — single event-listener with ResumeIntent + PublishIntent (planned, not started).
- **Hoist named-tool retry to `libs/agent-orchestrator`** — only if advisory agents start showing the same Sonnet flakiness; not seen yet (Spec 3 retain-as-defense decision).
- **Spec 3 Phase 1 reviewer Important findings** — `mandate_cta` missing ON RESPONSE marker; `mandate_consent` missing OPTIONS block. Stylistic, not functional. Revisit only if a future prompt audit asks for shape consistency across all 7 phases.
- **Generalise AppSync IAM publisher pattern into a shared lib** — three callers as of 2026-05-01: `services/investor/investor-bff/src/handlers/event-listener.ts:2,27,76` (publishDepositEvent), `services/investor/dashboard-bff/src/handlers/dashboard-publisher.ts` (publishDashboardUpdate), and planned `services/advisory/advisory-bff/src/handlers/decision-publisher.ts` from current ACTIVE. Three is the rule-of-three threshold; current copies all do their own SigV4 setup + mutation call. See `feedback_e2e_ui_assertions_only.md` for the principle that drove the third caller.
- **Vestigial MemoryStrategy declarations in decision-workflow-ctrl** — `services/advisory/decision-workflow-ctrl/src/service.stack.ts:36-78` declares 5 `MemoryStrategy` entries (`/portfolio-engine/{actorId}/rationale`, `/advisory-narrative/{actorId}/preferences`, etc.) that are no longer fed. Spec 2 (2026-04-30) replaced the `CreateEvent` + `RetrieveMemoryRecords` path that strategies process events for; the current `libs/agent-orchestrator/src/memory/memory-client.ts:43,60` uses `BatchCreateMemoryRecordsCommand` + `ListMemoryRecordsCommand` directly against `/{upstreamService}/{tenantId}/decisions/{decisionId}`. Strategies are provisioned but never receive input. Either remove or repurpose. Low priority — misleading-but-functional.
- **WSS subscription test harness in `libs/test-support`** — for integration tests that need to assert AppSync `@aws_subscribe` broadcasts actually deliver. Today's integration tests use `EventBridgeClient.putEvent` + `TableAssertions.waitForItem` against deployed dev (HTTP-only); no subscription client exists. This blocked Task 9 of Spec 5 (decision-update broadcast) — coverage for the broadcast path now relies entirely on per-handler unit tests + the 5-run e2e gate. Promote when a SECOND subscription needs integration coverage (advisory-bff `publishDecisionUpdate` is the first; dashboard-bff `publishDashboardUpdate` already shipped with no harness either). Pattern likely: a thin wrapper around AppSync SubscriptionClient + Cognito tokens, plus an awaitable frame collector.
- **Rename `NESTFOLIO_INTEG_PREFIX` env var to `PREFIX`** — the verbose `NESTFOLIO_INTEG_` namespace is friction every time we run e2e/integration locally. Four code refs: `libs/test-support/src/context.ts:46,49,51,54`, `libs/test-support/test/context.test.ts` (8 occurrences), `apps/nestfolio-e2e/playwright.config.ts:18`, `apps/e2e-feature-tests/jest.global-teardown.ts:4`. Plus ~15 plan/skill docs reference it. Rename should be atomic + sweep all docs in same PR; deploy script already accepts `--prefix=<custom>` so no infra impact.
- **Host runtime `config.json` regeneration is silently optional** — `apps/nestfolio-host/public/assets/config.json` carries the deployed BFF AppSync URLs, Cognito pool IDs, etc. Two latent bugs surfaced during Spec 5 e2e validation: (1) `infrastructure/scripts/deploy.sh` does not re-run `pnpm nx run nestfolio-host:config --prefix=<prefix>` after BFF redeploys, so a fresh deploy can leave the file pointing at stale URLs; (2) `nestfolio-host:build` does not copy the file from `apps/nestfolio-host/public/assets/` into `dist/apps/nestfolio-host/browser/assets/`, so even when config IS regenerated, the served bundle keeps the old one. Failure mode: shell loads `/assets/config.json` → gets the SPA `index.html` (404 fallback) → `JSON.parse('<!doctype...')` → "Federation init failed" → page renders empty `<generic>Failed to load application</generic>`. Two fixes needed (deploy hook + build asset wiring).
- **Refactor `deposit-page.component.ts` from subscribe-after-async (Pattern A) to subscribe-on-navigation (Pattern B)** — `apps/investor-mfe/src/app/deposit/deposit-page.component.ts:180` attaches `subscribeToDepositEvent(intent.depositId, ...)` only after `initiateDeposit()` returns, with `depositId` in component-local state. Two consequences: (1) page reload mid-flight loses the subscription (depositId gone, form re-rendered empty even though backend is still processing); (2) ~200ms AppSync handshake races a hot-Lambda DETECTED frame on broker-sim cached path → frame delivered to not-yet-attached subscriber, lost. Fix: read `depositId` from URL param or active-intent store on `ngOnInit`, attach subscription before any read, mirror Spec 5's R1 pattern from `apps/advisory-mfe/src/app/decision/decision-detail.component.ts:377`. Three other MFE views already follow Pattern B (dashboard-container, notification-list, decision-detail) — deposit-page is the lone holdout. ~30 LoC + a tiny route-param refactor. Natural pairing with the Step 9 decision-list workstream.
- **Bump `tsconfig.base.json` `lib` from ES2022 → ES2023** to enable `.toSpliced` / `.toReversed` / `.with` and other immutable array methods workspace-wide. Surfaced 2026-05-02 during Task 6 review of `feat/decision-list-pattern-b` — `apps/advisory-mfe/src/app/decision-list/decision-list.component.ts:194` could read more clearly as `current.toSpliced(idx, 1)` than `current.filter((_, i) => i !== idx)`. Workspace-scope change touching every project's type-checking; not Task 6 scope. Promote when at least one more caller would benefit.

---

## Recently shipped (last 14 days)

Compact list — full prose lives in user auto-memory `MEMORY.md` § "Recently Completed Work".

| Date | Item | Commit |
|---|---|---|
| 2026-05-02 | Spec 5 — decision-update broadcast pipeline (Step 10 unblocked; Step 9 refiled) | `feat/decision-broadcast` |
| 2026-05-01 | Spec 4 — recover originating specs (§21 OQ #11) | (this commit) |
| 2026-05-01 | Spec 3 — onboarding tool-call reliability | `fa78514c` |
| 2026-04-30 | Spec 2 — advisory pipeline consolidation | `7c91abb9..2c706015` |
| 2026-04-30 | Spec 1 — system architecture foundation docs | (multiple) |
| 2026-04-28 | Onboarding agent runtime redesign | `ba399082` |
| 2026-04-27 | MFE charter migration — full graduation | (multiple) |
| 2026-04-25 | A3 — per-BFF MFE bucket provisioning | (branch) |
| 2026-04-25 | A2 — `@nestfolio/frontend-deps` lib | `3fabbf9c` |
| 2026-04-24 | A1 — CSP single-source of truth | (branch) |
| 2026-04-22 | Onboarding runtime latent bugs (3) | (multi-commit) |
| 2026-04-21 | Agent contract tests | (multi-commit) |
| 2026-04-16 | CB AppSync IAM auth | (resolved) |
| 2026-04-15 | Circuit breaker redesign | (merged to main) |
