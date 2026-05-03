# Nestfolio Backlog

**Single source of truth for what to do next.** Three sections, in priority order.

**Discipline:**
- **One ACTIVE workstream at a time.** Anything else is QUEUED or PARKING LOT.
- **File-and-continue.** When a side-finding surfaces during execution, drop a one-liner into PARKING LOT (or the relevant topic memory) and continue the active workstream. Do not pivot mid-flight.
- **Scope contract.** Every spec/plan must have an explicit §"Out of scope" before execution starts. Out-of-scope failures during validation default to *file-and-continue*, not pivot.
- **Boundary review.** At each workstream ship, spend 5 min re-ranking PARKING LOT and promoting items to QUEUED if they've grown teeth.

Last reviewed: 2026-05-03 (after multi-SF entry retired-as-misdiagnosed — see below).
Updated 2026-05-03: "Multi-SF execution race per single decision trigger" retired. Diagnostic on 5 fresh SF starts (tenant `e2e-1777762060562`, 22:48–22:49 UTC 2026-05-02) showed 5 distinct trigger events (1× RISK_PROFILE_CREATED + 1× MANDATE_CREATED + 1× GOAL_CREATED + 2× DEPOSIT_DETECTED), each with unique `triggerEventId` + `decisionId`. Per `services/advisory/decision-workflow-ctrl/src/handlers/event-listener.ts:22-28` and `flows/advisory-cycle.flow.yaml` Phase 1b (`idempotent: false`), N triggers → N SF executions is **architectural intent**, not a bug. Refiled the real underlying problems below.

---

## ACTIVE

### `[design]` Collapse InvestorProfile to single-row CQRS BFF read model

**Adopted to ACTIVE:** 2026-05-03 (pivoted from "Onboarding fan-out 3 → 1" — see Recently Shipped table). Currently in **deep-review phase** before brainstorm continues — mapping obstacles and weaknesses across services, frontend, tests, flows, arch docs.

**Done when:**
1. `investor-bff` stores investor profile state as ONE DDB row per investor (sk = `'InvestorProfile'`), not a multi-row item-collection (Goal#id + RiskProfile + Mandate + OperatingMode + AccountMode + Deposit + InvestorProfile).
2. CDC fires ONE event (`INVESTOR_PROFILE_CREATED` / `INVESTOR_PROFILE_UPDATED`) when the profile changes — collapsing today's per-sub-entity GOAL_*, RISK_PROFILE_*, MANDATE_*, OPERATING_MODE_* into one logical event stream.
3. Onboarding produces ONE decision cycle (the original "3 → 1" outcome falls out as a side-effect, not the goal).
4. `dashboard-bff` snapshot transform refreshes from one composite event instead of switching on per-field event type.
5. `compliance-ctrl` reads mandate-shape fields from the composite payload (no semantic change to compliance logic).
6. `investor-ctrl` notification-lifecycle is updated to either (a) diff CDC OldImage/NewImage to derive specific notifications, or (b) emit semantic action events from BFF mutation resolvers (`USER_UPDATED_GOAL`, `USER_REVOKED_MANDATE`) for notifications, separating semantic events from CDC data-change events. Decision in design phase.
7. GraphQL surface drops plural `getGoals: [Goal!]!` → `getProfile.goal: String!` (or single goal scalar fields on `InvestorProfile`); drops `Mandate.version` field; drops `RiskProfile.version`/`assessedAt` (or moves to `InvestorProfile` as `lastRiskAssessmentAt`); revocation works as a state flag (`revokedAt`) on the composite row.
8. Dead `version: 1` fields removed everywhere (currently set once, never incremented, never read).
9. Multi-row scaffolding (`Goal#${goalId}` plural, `Mandate.version` history hooks, `RiskProfile.version` history hooks) removed — these were YAGNI futureproofing for plural-goals + entity-versioning that no spec requires (verified 2026-05-03 against `specifications/01-04-*.md` + `docs/architecture/*.md` + `docs/superpowers/specs/*.md`).
10. Frontend (`apps/investor-mfe`, `apps/onboarding-mfe`, `apps/advisory-mfe`, `apps/dashboard-mfe`) updated to query collapsed shape.
11. Validation: full e2e suite passes (incl. Scenario 5 "revoke mandate", Scenario 3 "update investment goal"). Onboarding produces 1 cycle (verified by integration test asserting SF execution count = 1 within 60s).

**Why this scope (vs the original "3 → 1" tactical fix):** the fan-out bug is a symptom; the root cause is the multi-row decomposition of a single logical entity (the investor's profile). The schema-level scaffolding (`Goal#${goalId}` plural, `version: 1` set-once-never-incremented, `revokedAt` working as state flag not history) was empirically NOT load-bearing per business specs (every spec references investor goals as singular; no spec requires entity versioning at the BFF layer; revocation works as state, not history). Per CQRS, BFFs are read models + command handlers — versioning/history belongs to a future audit projection, not the BFF. Collapsing dissolves the fan-out problem at root, removes ~3 dead schema fields, and aligns the BFF with the read-model role the rest of the system already uses (Decision Packets follow this pattern correctly).

**Out of scope (file-and-continue if surfaced):**
- Future audit-projection service for entity history (becomes its own workstream IF/WHEN regulatory or compliance need is articulated).
- Future multi-goal product feature (would reintroduce a `Goals` collection with concrete requirements driving the schema).
- The 147 stuck SF executions cleanup (separate QUEUED entry — depends on Step 8/10 fix, not this collapse).
- `MANDATE_UPDATED` missing from `TRIGGER_EVENT_TYPES` (already in PARKING LOT — would be naturally subsumed by `INVESTOR_PROFILE_UPDATED` becoming a trigger).

**References:**
- `docs/architecture/SYSTEM-ARCHITECTURE.md` §13 (Decision Lifecycle — trigger semantics simplify), §11 (Idempotency — single-writer per row remains), §18 (Cross-Domain Routing — advisory-adpt rule simplifies to forward `INVESTOR_PROFILE_*`), §10.1 (Canonical emission points — adds new canonical pair, deprecates 3 olds)
- `docs/architecture/SERVICE-INVENTORY.md` § `investor-bff` (Egress eventTypes mapping changes from 9-shape map to 3-4-shape map), § `dashboard-bff` (event subscriptions simplify), § `investor-ctrl` (notifications path needs re-design), § `compliance-ctrl` (read shape unchanged), § `decision-workflow-ctrl` (TRIGGER_EVENT_TYPES drops 3, gains 1 per onboarding + 1 per profile-change)
- `flows/investor-onboarding.flow.yaml` (Phase 2a transactWrite collapses; Phase 6 cross-domain forwarding simplifies), `flows/advisory-cycle.flow.yaml` (Phase 1 trigger list collapses), `flows/portfolio-rebalance.flow.yaml`, `flows/go-live.flow.yaml` (verify no breakage)
- Code anchors: `services/investor/investor-bff/src/transforms/onboarding-completed.ts` (transactWrite surface), `services/investor/investor-bff/src/repositories/investor-profile.repository.ts` (Goal/Mandate/RiskProfile read+write surface), `services/investor/investor-bff/src/schema.graphql` (GraphQL contract), `services/investor/investor-bff/src/graphql/js-function/*.fn.js` (AppSync JS resolvers), `services/investor/dashboard-bff/src/transforms/investor-snapshot.ts`, `services/investor/investor-ctrl/src/services/notification-lifecycle.service.ts`, `services/advisory/compliance-ctrl/src/handlers/event-listener.ts`, `services/advisory/decision-workflow-ctrl/src/domain/events.ts`, `services/advisory/advisory-adpt/src/service.stack.ts`

**Empirical evidence behind "scaffolding not load-bearing"** (2026-05-03):
- All `version: 1` literals set in `onboarding-completed.ts:90,136` + `repository.ts:184,228` — no code increments them. `grep mandate.version` / `riskProfile.version` returns zero read sites that branch on value.
- `getGoals: [Goal!]!` plural — every consumer reads index `[0]`. No test creates a 2nd goal. Onboarding wizard captures one. No spec describes >1 goal per investor.
- `revokeMandate` mutation works via `UpdateExpression: 'SET revokedAt = :revokedAt'` — modifies single row in place; doesn't preserve history.
- No regulator citation in `specifications/04-governance.md` requires entity-version history at BFF layer (Decision Packets already carry the audit trail).

**Topic memory:** `project_decision_workflow_stuck.md` + `project_playwright_e2e_ui.md` (the symptom this fixes); a new `project_investor_profile_collapse.md` to be created during deep-review synthesis.

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

**Why this slot (above the cleanup chore below):** Step 8 and Step 10 (Confirm button → WSS callback) likely share root cause in WSS subscription delivery semantics — fixing this also fixes Step 10, which drains the 147 stuck SFs (next entry) at the source. Sequence wins over symptom-treatment.

---

### `[chore]` Stop + clean up 147 stuck Step Function executions on dev

**Done when:** `aws stepfunctions list-executions --status-filter RUNNING` on `dev-decision-workflow-ctrl-decisionstatemachine` returns 0 executions older than 24h, AND no orphaned task-token DDB rows remain in `dev-advisory-bff-StateTable962DE04C-1VGXL2KZX3AUM`.

**Status:** Surfaced 2026-05-02. **147 of 676 historical executions on `dev-decision-workflow-ctrl-decisionstatemachine` are stuck RUNNING** (vs 15 SUCCEEDED, 499 FAILED, 15 TIMED_OUT — 2.2% success rate since 2026-04-20). Each stuck execution sits at the `RequestUserConfirmation` task-token wait: WaitForCompliance returned, the user-confirm task token was issued, and Step 10's WSS callback never fires reliably so the token is never returned. SF default 1-year timeout means they'd sit there until 2027 without intervention.

**Mechanism:** stuck-at-`RequestUserConfirmation` is the symptom; the root cause is Step 10 (Confirm button → `confirmDecision` mutation → WSS callback) being unreliable. Fixing the previous QUEUED entry (Step 8 WSS bug, family-resemblance fix expected to also close Step 10) drains the source. This entry is the one-time hygiene to clean up the existing residue.

**Fix:**
1. Bash one-liner to stop all stuck executions older than 24h:
   ```bash
   aws stepfunctions list-executions --state-machine-arn arn:aws:states:us-east-1:771924376645:stateMachine:dev-decision-workflow-ctrl-decisionstatemachine --status-filter RUNNING --region us-east-1 --max-items 1000 --output json | jq -r '.executions[] | select(.startDate < (now - 86400)) | .executionArn' | xargs -I{} aws stepfunctions stop-execution --execution-arn {} --region us-east-1
   ```
2. DDB scan for orphaned task-token rows (`sk` begins with `TaskToken#` and the corresponding decisionId is in a stuck-pending status with no live SF) → batch delete.
3. Verify count drops to 0.

**Why slot 3 (not slot 2):** the 147 executions are dev-test residue — no real users, sole-dev account, no SF concurrency budget hit (Standard SF has no concurrent-running ceiling), small DDB storage cost. Cleanup is a 5-min chore. Real protection comes from fixing Step 8/10 (the previous slot), which prevents new stuck SFs accumulating; without that fix, this cleanup just kicks the can.

**Topic memory:** `project_decision_workflow_stuck.md`.

---

### `[design]` Operating mode feature

**Status:** DESIGN IN PROGRESS (2026-04-14). Captured at onboarding but not wired into advisory behavior.

**Done when:** AGGRESSIVE/BALANCED/CONSERVATIVE actually drives portfolio-engine + advisory-narrative behavior.

**References:**
- `docs/architecture/SYSTEM-ARCHITECTURE.md` §14 (Operating Modes & Guardrails) — canonical definition of the 3 modes + how they interact with mandate + agent behavior
- `docs/architecture/SERVICE-INVENTORY.md` § `portfolio-engine-ctrl` + § `advisory-narrative-ctrl` (the two consumers that need mode-driven behavior), § `investor-bff` (where mode is captured at onboarding + emitted via `OPERATING_MODE_CHANGED`)
- `flows/advisory-cycle.flow.yaml` Phases 2c (PortfolioEngine) + 2d (AdvisoryNarrative) — where mode would gate agent behavior
- Code: `services/investor/investor-bff/src/transforms/onboarding-completed.ts` (mandate level branch by mode), agent-factory in `libs/agent-orchestrator`

**Topic memory:** `project_operating_mode.md`.

---

### `[design]` Integration test mock resilience

**Status:** DESIGN IN PROGRESS (2026-04-16). FakeLlm via env var in agent-factory; StateResetFixture for stale state; SsmOverride verification.

**References:** *Test-infrastructure design — arch docs do not apply directly. Canonical references are the libs being modified:*
- `libs/integration-testing/` — current EventBusTrap, TableAssertions, MockApiFixture, resilience helpers
- `libs/test-support/` — TestContext, CognitoFixture, EventBridgeClient, AppSyncClient
- `libs/agent-orchestrator/src/agent-factory.ts` — single LLM injection point (see MEMORY.md technical note "single LLM injection point — `createAgentNode()` line 20")
- `docs/architecture/SYSTEM-ARCHITECTURE.md` §11 (Idempotency & Safety Rules) — *tangential*, the resilience tests check these properties

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
- **`/advisory` shows empty state when `pendingDecisionsCount > 0` and the list query is empty** — UX bug. Real users clicking the dashboard alert immediately can hit this when the agent pipeline (advisory-bff projection) lags the dashboard counter by 30–75s. Surfaced 2026-05-02 during Pattern B Step 9 e2e gate (Run 3 fail). Patched test-side via `apps/nestfolio-e2e/src/fixtures/wait-for-advisory-projection.ts` Step 8 wait. Proper fix: when `dashboard.pendingDecisionsCount() > 0` AND `decisions().length === 0`, show a loading shimmer / "agent is generating recommendations…" instead of `advisory.list.emptyTitle`. Touch points: `apps/advisory-mfe/src/app/decision-list/decision-list.component.ts` template @if branches + read of dashboard count via shared store or fresh query. Promote when the test-side patch becomes load-bearing in CI or user-testing surfaces the empty-state confusion.
- **`publishDecisionUpdate` omits decision-detail null fields** — `PUBLISH_DECISION_UPDATE` in `services/advisory/advisory-bff/src/handlers/decision-publisher.ts` sets only {decisionId, tenantId, status, trigger, explanation, proposedTrades, version, createdAt, updatedAt}. `confirmedAt`/`rejectedAt`/`rejectionReason`/`confirmationRequired` arrive as null at decision-detail's `onDecisionUpdate` handler, which calls `store.setDecision(updated)` (replace, not merge — `apps/advisory-mfe/src/app/decision/decision-detail.component.ts:380`). Latent: any IAM-published mid-cycle frame would erase those fields. Currently masked because `confirmDecision`/`rejectDecision` re-broadcast via DDB readback. Surfaced 2026-05-02 during decision-list Pattern B workstream.
- **Verify whether `DEPOSIT_DETECTED` is double-emitted upstream** — diagnostic 2026-05-03 (tenant `e2e-1777762060562`) showed 2 distinct `DEPOSIT_DETECTED` events in 15s with different `depositId`s (`0ee4082f…` EUR 500 and `76b39b5f…` USD 5000). Could be intentional e2e (two test deposits) OR a real upstream double-emit (broker-sim/investor-bff fan-out). To verify: cross-check `apps/nestfolio-e2e/` test step that initiates deposit — does it call `initiateDeposit` once or twice? If once, the upstream is dup-emitting and is a real bug worth promoting. If twice, by-design and drop. ~10 min check.
- **Add SF-start idempotency by `executionName = decisionId`** — `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts` Orchestration construct currently lets AWS auto-name SF executions (we observed format `{uuid}_{uuid}`), and `flows/advisory-cycle.flow.yaml` Phase 1b explicitly flags `idempotent: false  # duplicate WORKFLOW_TRIGGER_CREATED events start duplicate executions`. Setting `executionName` to the trigger's `decisionId` (= `triggerEventId`) would make AWS reject same-name duplicate StartExecution calls within 90 days. Cheap defense against any upstream double-emit OR EB at-least-once redelivery. Won't help with the legitimate-N-triggers case (each has a unique decisionId), but closes the architectural `idempotent: false` flag and removes a class of failure that's currently silently undetectable. Promote if the deposit-double-emit verification (above) confirms an upstream bug, OR if EB redelivery storms become observable.
- **`revokeMandate` GraphQL mutation is half-implemented (latent)** — `services/investor/investor-bff/src/graphql/js-function/revoke-mandate.fn.js` writes a `MandateRevocation` row + `EditEvent` row, returns a faked `_revokeResult` from `ctx.stash` with `revokedAt: now`, but **NEVER updates the actual Mandate row's `revokedAt`** field — so `getMandate` (or any subsequent read of the Mandate row) returns the un-revoked state. ALSO: `MANDATE_REVOKED` event type is declared in `services/investor/investor-bff/src/domain/events.ts:18` but `MandateRevocation` __typename is NOT mapped in `services/investor/investor-bff/src/service.stack.ts` Egress eventTypes block — so no CDC event is emitted on revocation today (test comment at `services/investor/investor-bff/test/integration/investor-bff.integration.test.ts:628` confirms: "MandateRevocation __typename is NOT in CDC eventTypes map — no CDC event emitted"). NATURALLY SUBSUMED by the InvestorProfile collapse workstream (ACTIVE 2026-05-03) — the rewrite of revoke-mandate.fn.js to do a 3-row transactWrite (update composite InvestorProfile mandate.status + write MandateRevocation audit row + write EditEvent log) + map MandateRevocation→MANDATE_REVOKED in Egress closes both gaps. Tracked here only in case the collapse stalls and someone needs to fix the bug standalone earlier.
- **`MANDATE_UPDATED` missing from `TRIGGER_EVENT_TYPES`** — `services/advisory/decision-workflow-ctrl/src/domain/events.ts:34-46` lists 11 trigger events; `MANDATE_UPDATED` is not among them, although `MANDATE_CREATED`, `GOAL_UPDATED`, `RISK_PROFILE_UPDATED`, `OPERATING_MODE_CHANGED` all are. Result: a user editing their mandate (level change, turnover-cap edit, etc.) emits `MANDATE_UPDATED` via investor-bff Egress (`services/investor/investor-bff/src/service.stack.ts:72-73`) and advisory-adpt forwards it (`services/advisory/advisory-adpt/src/service.stack.ts:42` lists `MANDATE_UPDATED` in `fromInvestorEvents`) but decision-workflow-ctrl does not subscribe → no re-cycle. Surfaced 2026-05-03 during onboarding-fanout design Q2 follow-up. Cheap fix: add `eventName('MANDATE_UPDATED')` to TRIGGER_EVENT_TYPES + add to advisory-cycle.flow.yaml Phase 1 list. Promote when a real mandate-edit UI flow needs to trigger a re-cycle.
- **Sweep stale local branches + unused worktrees** — as of 2026-05-02 the local clone has 16 unmerged-named `feat/` `refactor/` `docs/` branches plus 2 worktrees (`.worktrees/ledger-domain` for `feature/ledger-domain-restructure` at `079f005b`, `.worktrees/playwright-e2e` for `feat/playwright-e2e-ui` at `20971554`). Most appear shipped per MEMORY.md "Recently Completed Work" (a2-frontend-deps, b1-cloudfront, b2-federation, b4-shell, c-cleanup-and-playwright, d-mfe-deploy, f-loadmfe, g-feature-flags, agentcore-transport, integration-test-resilience, real-money-ops, etc.) but `git branch -d` may refuse if they're squash-merged or rebased (not direct ancestors of `main`). For each branch: cross-check against MEMORY.md / `git log` on main for the corresponding ship commit, then `git branch -D` if confirmed shipped, or `git rebase main && git branch -d` if cleanly forward. For worktrees: `git worktree remove .worktrees/<name>` after confirming no uncommitted work in each. Sole-dev project — no risk of stomping a teammate. ~15 min chore. Promote when the long branch list becomes friction (tab-completion noise, accidental checkout of a stale branch).
- **investor-bff has 13 latent `tsc --noEmit` errors** — branded `TenantId`/`UserId` cast mismatches in `services/investor/investor-bff/src/transforms/{onboarding-completed,balance-updated,notification-created,user-registered}.ts`; `transactWrite` protected-access leak at `services/investor/investor-bff/src/transforms/onboarding-completed.ts:39` (transform calls a base-class protected method from outside the class); `timestamp` not on `TableEntry` / `EventPayload` interfaces (used in repository writes + broadcast-listener). Pre-existed Task 1.10; verified at parent commit `0378ec25`. NOT a Phase 9 deploy blocker — Lambda bundling uses esbuild (strips types) and CDK synth uses `ts-node` transpile-only; jest passes 72/72. Filed during InvestorProfile collapse workstream 2026-05-03. Promote as a focused cleanup pass when type debt becomes load-bearing (e.g. when a fresh service onboard lands a developer who trusts `tsc --noEmit` as a quality gate).
- **Extend `Orchestration` construct with `executionNameField: string` prop (JSONPath)** — `libs/cdk-constructs/src/core/orchestration.ts:30` currently exposes only a fixed-string `executionName` prop that SUPPRESSES EB rules entirely (singleton-guard pattern). InvestorProfile collapse Plan Task 2.3 (`docs/superpowers/plans/2026-05-03-investor-profile-collapse-plan.md:1820-1822`) needs the OPPOSITE: keep the auto-generated EB→SF rules AND set the SF target's execution name to a JSONPath into the EB event (e.g. `$.detail.id`) for cross-redelivery/replay/region idempotency. This is a real construct API gap, not an escape hatch. Implementation: thread `props.executionNameField` through to `SfnStateMachine` target — CDK target options accept `name` via `RuleTargetInput`, but per-execution-name from event path needs the EB→SF native integration's `RoleArn` + Input shape. Likely needs `CfnRule` `Targets[].SfnParameters` or Input transformation. **BLOCKS**: Plan Task 2.3 — surfaced 2026-05-03 by the user's explicit instruction not to use a service-stack-level CfnRule escape hatch without authorization.

---

## Recently shipped (last 14 days)

Compact list — full prose lives in user auto-memory `MEMORY.md` § "Recently Completed Work".

| Date | Item | Commit |
|---|---|---|
| 2026-05-03 | Multi-SF execution race entry retired-as-misdiagnosed (refiled as onboarding fan-out + 2 PARKING LOT items) | (this conversation) |
| 2026-05-02 | Decision-list Pattern B (Step 9 5/5 gate green) | `feat/decision-list-pattern-b` |
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
