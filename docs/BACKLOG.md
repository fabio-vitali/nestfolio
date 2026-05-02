# Nestfolio Backlog

**Single source of truth for what to do next.** Three sections, in priority order.

**Discipline:**
- **One ACTIVE workstream at a time.** Anything else is QUEUED or PARKING LOT.
- **File-and-continue.** When a side-finding surfaces during execution, drop a one-liner into PARKING LOT (or the relevant topic memory) and continue the active workstream. Do not pivot mid-flight.
- **Scope contract.** Every spec/plan must have an explicit §"Out of scope" before execution starts. Out-of-scope failures during validation default to *file-and-continue*, not pivot.
- **Boundary review.** At each workstream ship, spend 5 min re-ranking PARKING LOT and promoting items to QUEUED if they've grown teeth.

Last reviewed: 2026-05-01 (after Spec 4 ship `89f4f169` — system architecture docs workstream now complete).
Updated 2026-05-01: promoted Steps 9-10 advisory-mfe blockers to ACTIVE.

---

## ACTIVE

### `[e2e]` Journey Steps 9-10 — advisory-mfe blockers

**Done when:** `new-investor-happy-path.spec.ts` passes Steps 9-10 (decision-list navigation + Confirm button) reliably across 5 consecutive runs.

**Status:** Promoted from QUEUED 2026-05-01. Pre-existing per sixth-session memory; surfaced again in Spec 3's 5-run gate (3/5 fails on these steps).

**Concrete failures:**
- `apps/nestfolio-e2e/src/pages/advisory.page.ts:20` — `goToFirstPendingDecision()` waits for `a[data-testid^="decision-"]` and times out at 15s.
- `apps/nestfolio-e2e/src/pages/advisory.page.ts:34` — `confirm()` waits for `getByRole('button', { name: /confirm|conferma/i })` and times out.

**Candidate root causes (eighth-session architectural findings, not yet ruled out):**
1. Dual `DECISION_PACKET_CREATED` emitter race (advisory-ctrl + decision-workflow-ctrl) — projection state nondeterministic.
2. advisory-ctrl synchronous agent pipeline hits 30s Lambda timeout — `AGENTS_COMPLETED` rarely fires → status stuck at `PENDING` → no confirm button.
3. AgentCore Memory namespace write/read mismatch — AssemblePacket can't read upstream agent outputs (workaround placeholder shipped 2026-04-30).
4. SF stuck at `WaitForCompliance` (separate, tracked in `project_decision_workflow_stuck.md`).

**Topic memory:** `project_playwright_e2e_ui.md` (search "Spec 3 ship-time blockers below onboarding"); `project_decision_workflow_stuck.md`.

**Next step:** brainstorm scope — fix surface (mfe-only patch / advisory-bff projection / advisory-ctrl pipeline removal / SF unstick) before writing a spec.

---

## QUEUED

Ordered by priority. Top of list = what to start next.

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

---

## Recently shipped (last 14 days)

Compact list — full prose lives in user auto-memory `MEMORY.md` § "Recently Completed Work".

| Date | Item | Commit |
|---|---|---|
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
