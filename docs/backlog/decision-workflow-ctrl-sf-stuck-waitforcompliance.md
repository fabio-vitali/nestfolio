---
id: decision-workflow-ctrl-sf-stuck-waitforcompliance
status: dropped
type: bug
notes: "PREMISE INVALIDATED 2026-05-09 — SF is NOT stuck at WaitForCompliance. Real failure is fast-fail at InvokeInvestorProfile (UnknownOperatingModeError) — superseded by non-investor-profile-trigger-operating-mode-lookup."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory:
  - project_decision_workflow_stuck.md
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

---

## Dropped 2026-05-09 — premise empirically false

Investigation against deployed dev (50 most recent executions of `arn:aws:states:us-east-1:771924376645:stateMachine:dev-decision-workflow-ctrl-decisionstatemachine`):

- **0 RUNNING executions.** Nothing is waiting on a 24h `WaitForCompliance` timeout.
- **23 SUCCEEDED** in ~2 minutes each (full agent pipeline → compliance → end). Compliance callback chain works.
- **27 FAILED** in <1 second. All 8 sampled show identical error:
  - `error: UnknownOperatingModeError`
  - `cause: operatingMode missing for decision <uuid> at subject.investorProfile.operatingMode || subject.investorProfile.mandate.operatingMode. Available keys=[pk,sk,__typename,tenantId,userId,region,eventName,eventId,depositId,executionMode,createdAt,amountCents,currency,timestamp]. Refusing to silently default to BALANCED — fix the upstream propagation.`

Failure is at `InvokeInvestorProfile` (the very first agent step), NOT at `WaitForCompliance`. Cited e2e test paths (`first-decision.e2e.test.ts`, `rebalance-on-drift.e2e.test.ts`, `reconciliation-drift.e2e.test.ts`) do not exist under `apps/e2e-feature-tests/src/advisory/`.

Real bug = rank-2 [non-investor-profile-trigger-operating-mode-lookup](non-investor-profile-trigger-operating-mode-lookup.md). That workstream already names the exact failure mode: non-INVESTOR_PROFILE_* triggers (DEPOSIT_DETECTED, ORDER_*, PORTFOLIO_DRIFT_DETECTED) lack `operatingMode` on their trigger payload, and the recently-shipped `operating-mode-shape-empty-proposed-trades` workstream made the handler refuse to silently default to BALANCED.

Promoting rank-2 to ACTIVE in this same session.
