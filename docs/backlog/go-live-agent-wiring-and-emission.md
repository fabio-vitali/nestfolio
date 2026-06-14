---
id: go-live-agent-wiring-and-emission
status: active
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
validation_gate: null
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
