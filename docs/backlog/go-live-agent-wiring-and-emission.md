---
id: go-live-agent-wiring-and-emission
status: shipped
type: bug
rank: 1
notes: "Go-live is non-functional end-to-end: onboarding-bff confirmGoLive() (writes GoLiveConfirmed CDC row -> GO_LIVE_CONFIRMED) has NO runtime caller, so the simulation->live switch never fires; the wizard renders but the agent ignores flowType='go-live'. No e2e coverage. Surfaced 2026-06-14 by the flows-vs-code audit (go-live.flow.yaml). Done includes refreshing go-live.flow.yaml + regenerate."
references: []
out_of_scope:
  - "The downstream simulation->live chain (go-live.flow.yaml steps 2-4: investor-bff setExecutionMode -> EXECUTION_MODE_CHANGED -> execution-adpt forward -> broker-ctrl ExecutionMode='live') is already wired; verify-only, do NOT re-implement."
  - "Broker live-trading / Alpaca routing behavior itself (already exists)."
  - "Onboarding agent refactors beyond what is required to reach the GO_LIVE_CONFIRMED trigger."
  - "Frontend go-live wizard UI/UX changes beyond invoking the chosen trigger."
  - "Notifications/observability for the go-live transition."
  - "Provisional list pending brainstorming; will be reconciled with the spec's canonical Out-of-scope section."
spec: docs/superpowers/specs/2026-06-14-go-live-functional-design.md
plan: docs/superpowers/plans/2026-06-14-go-live-functional.md
topic_memory: []
validation_gate: |
  Shipped 2026-06-15 on branch worktree-go-live-agent-wiring (P1–P4).
  ARCHITECTURE CHANGE: the dead onboarding-agent GO_LIVE_CONFIRMED trigger was removed; the
  switch is now an investor-bff confirmGoLive AppSync mutation (atomic 3-item TransactWrite →
  EXECUTION_MODE_CHANGED + MANDATE_REAFFIRMED + INVESTOR_PROFILE_UPDATED).
  P1 (sim→live switch, closes the filed bug): confirmGoLive resolver + GO_LIVE_CONFIRMED removed
  (investor-bff + onboarding-bff dead code) + deterministic Jest e2e.
  P2: cdk-constructs Facade esbuild .fn.ts bundling + updateRiskProfile.fn.ts (imports computeRiskProfile).
  P3: MANDATE_REAFFIRMED producer + advisory-adpt forward + compliance-ctrl MandateSnapshot.
  P4: editable review-and-revise wizard (investor-mfe) + GoLiveService + /settings/go-live route;
  dashboard executionMode read-model (dashboard-bff InvestorSnapshot + live badge wiring, user-approved
  Option A); flow spec rewrite + data-flows + 4 service cards (card-drift gate green) + C4 regen.
  VALIDATION: affected test+lint (42 projects) green; deploy investor-bff,dashboard-bff,investor-mfe,
  dashboard-mfe to dev green; Jest go-live-switch e2e PASSED on deployed dev (1/1, 78s — sim→live +
  EXECUTION_MODE_CHANGED + broker-ctrl ExecutionMode + MANDATE_REAFFIRMED + compliance MandateSnapshot);
  dashboard live-badge plumbing renders (page snapshot shows sim pre-go-live).
  KNOWN GAP (filed): the Playwright happy-path journey was extended through go-live but is blocked
  UPSTREAM at the decision step (decision-workflow SF wedged at .waitForTaskToken; executions stuck
  since before the deploy — pre-existing, not a go-live regression), so the go-live UI badge assertion
  is unexercised. Tracked QUEUED as happy-path-decision-sf-waitfortasktoken-wedge. Final review:
  APPROVED FOR MERGE. Parked finding: mandate-reaffirm-operatingmode-required-legacy-dlq.
---

# Go Live agent path unwired — GO_LIVE_CONFIRMED never emitted

The simulation→live switch (steps 2–4 of `flows/go-live.flow.yaml`) is wired correctly, but its
**trigger never fires** because the onboarding agent never reaches `confirmGoLive()`.

## Evidence (`services/investor/onboarding-bff`)

- `src/repositories/onboarding.repository.ts:121-151` — `confirmGoLive()` correctly writes
  `OnboardingSession` (status='completed', currentPhase='go_live_confirmation') + a `GoLiveConfirmed`
  CDC row.
- `src/service.stack.ts:27` — Egress maps `GoLiveConfirmed:INSERT → GO_LIVE_CONFIRMED` (mapping fine).
- BUT `confirmGoLive()` has **no caller**: `src/agent/state.ts:5-13` `PHASE_ORDER` ends at
  `mandate_cta` (no go-live phases); `src/agent/tools/commit-phase.ts:59-61` only calls
  `completeSession` on `mandate_consent`; `flowType='go-live'` is read **nowhere** in
  `agents/onboarding/*` or `src/agent/*`. The go-live phases + `flowType:'go-live'` exist only as zod
  schema in `src/domain/schemas.ts:3-35`.
- Frontend navigates to onboarding-mfe with `queryParams:{flowType:'go-live'}`
  (`apps/investor-mfe/src/app/settings/go-live/go-live-wizard.component.ts:343-345`) — the wizard
  renders but the backend agent ignores `flowType`.

Consequence: completing the Go Live wizard produces no `GO_LIVE_CONFIRMED`, so the
investor-bff→broker-ctrl `executionMode='live'` chain never runs. Zero e2e coverage — both
contract-emission tests document the gap (`investor/investor-contract-emission.e2e.test.ts:17-19`,
`execution/execution-contract-emission.e2e.test.ts:378-380`).

## Done

1. Wire `flowType='go-live'` through the onboarding agent so the go-live phases run and
   `confirmGoLive()` is invoked (or choose an explicit alternative trigger for `GO_LIVE_CONFIRMED`).
2. Add an e2e covering the simulation→live switch (no coverage today).
3. Refresh `flows/go-live.flow.yaml` (drop the "emission path NOT wired" trigger caveat + the Step-1
   dead-code annotations), regenerate `docs/data-flows/`, and re-run `validate-flow go-live`.
