---
id: decision-workflow-ctrl-sf-stuck-waitforcompliance
status: parking
type: bug
notes: "decision-workflow-ctrl SF starts but never completes — task token from compliance never callback. Blocks 3 of 4 failing e2e scenarios (11/12/13)."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# decision-workflow-ctrl Step Function stalls at `WaitForCompliance`

The advisory agent pipeline starts on every trigger event but never reaches a terminal state. Open since 2026-04-29 (memory: `project_decision_workflow_stuck.md`). The SF entry stage runs (decisionId minted via `States.UUID()`), agents are invoked, but the `WaitForCompliance` callback step times out — the compliance task token is never resolved and the SF eventually hits its 72h timeout window without producing `DECISION_PACKET_CREATED`.

**Blocks 3 of 4 failing e2e scenarios (validated 2026-05-09 against deployed dev):**
- `apps/e2e-feature-tests/src/advisory/first-decision.e2e.test.ts` — scenario 11 (live AgentCore pipeline via INVESTOR_PROFILE_CREATED)
- `apps/e2e-feature-tests/src/advisory/rebalance-on-drift.e2e.test.ts` — scenario 12 (PORTFOLIO_DRIFT_DETECTED → rebalance decision)
- `apps/e2e-feature-tests/src/advisory/reconciliation-drift.e2e.test.ts` — scenario 13 (ALPACA_ACCOUNT_SNAPSHOT drift → corrective decision)

Each test waits for a decision row to materialise; the rows never appear because the SF doesn't complete.

**Cheapest next step:** read recent SF execution history on dev (`aws stepfunctions list-executions --state-machine-arn <decision-workflow-ctrl-DecisionStateMachine arn>` then `get-execution-history` on a stuck execution). Identify whether the WaitForCompliance step is timing out vs. compliance-ctrl emitting the callback to a wrong endpoint. The 5th-session Playwright e2e plan (per memory) misdiagnosed this as "WSS subscription broken" — the actual fault is in the SF↔compliance task-token roundtrip.

**Related:** `non-investor-profile-trigger-operating-mode-lookup` is a separate gap that affects scenarios 12/13 secondarily — fixing the SF stall first is the load-bearing change; the operating-mode gap can be cleaned up after.

Surfaced 2026-04-29 originally; re-confirmed 2026-05-09 during validation gate of `advisory-empty-state-pending-decisions-count` workstream.
