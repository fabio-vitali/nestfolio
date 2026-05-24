---
id: e2e-test-tolerance-or-agent-constraint-against-suitability-block
status: queued
rank: 5
type: bug
notes: "new-investor-happy-path expects AWAITING_CONFIRMATION but the LLM-generated equity allocation (typically 55% across VTI+IXUS+QQQ+VWO) exceeds the riskScore=5 suitability cap (50%) → compliance correctly BLOCKS. Test is non-deterministic against agent output. Surfaced 2026-05-24 by Bug C during the silent-dedup workstream — badge transitions correctly to BLOCKED, the test just doesn't accept that outcome."
references:
  - path: services/advisory/compliance-ctrl/src/rules/suitability-checker.ts
    anchor: L47
  - path: apps/nestfolio-e2e/src/pages/advisory.page.ts
    anchor: L50-L66
  - path: apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts
    anchor: L171-L179
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Test expects AWAITING_CONFIRMATION but LLM can legitimately trigger BLOCKED

The `new-investor-happy-path` Playwright scenario asserts the badge transitions to AWAITING_CONFIRMATION (Step 10 — `advisory.page.confirm()`). That state only fires on the `APPROVED + L2` path through compliance, which requires a non-violating allocation.

The advisory agent pipeline (InvestorProfile → MarketIntelligence → PortfolioEngine → AdvisoryNarrative) produces equity allocations that typically sum to ~55% across VTI + IXUS + QQQ + VWO at `riskScore=5`. The SuitabilityChecker enforces `resultingEquity <= maxEquityPercent[riskScore]` (50% for risk-score 5) at `services/advisory/compliance-ctrl/src/rules/suitability-checker.ts:47` → emits a BLOCKING violation → compliance returns `BLOCKED+L2` → SF terminates at EndBlocked → DECISION_BLOCKED reaches advisory-bff → badge transitions to BLOCKED.

The fix shipped in `new-investor-happy-path-pending-at-decision-confirm` correctly propagates the BLOCKED status end-to-end, but the test doesn't accept that outcome.

## Two fix lanes

1. **Test-tolerance:** widen the Playwright assertion so EITHER `AWAITING_CONFIRMATION` OR `BLOCKED` is accepted as a valid terminal state. The test then validates "badge reached a terminal compliance state" instead of "always reaches user-confirmation". Cheaper.
2. **Agent-constraint:** pin the agent prompts (or post-process the PortfolioEngine output) so allocations always satisfy the suitability cap for the e2e tenant's risk score. Deterministic outcome, but couples agent behaviour to a test contract. More invasive.

## Evidence

Real dev runs in the 2026-05-24 workstream:

- Tenant `e2e-1779639802145-0fae7332`: 6 SF executions, all `complianceResult: { decision: 'BLOCKED', authorityLevel: 'L2' }` via `MAX_SINGLE_TRADE` + `TURNOVER_CAP` violations. AssemblePacket output recorded `proposedTrades` with equity = 55%.
- Tenant `e2e-1779655130235-d4ff048a`: 3 SF executions, same outcome.
- After Bug A+D+E shipped, Playwright shows `Decision status badge = "BLOCKED"` — proves the chain works, just not the AWAITING_CONFIRMATION path.

## Related

- Parent workstream: `new-investor-happy-path-pending-at-decision-confirm`
- Rule engine: `services/advisory/compliance-ctrl/src/rules/{suitability-checker,authority-resolver,rule-engine}.ts`
- 2026-04-29 mandate-level forcing (e2e tenant gets ADVISORY → L2 escalation): topic memory `project_decision_workflow_stuck.md`
