---
id: operating-mode-shape-empty-proposed-trades
status: queued
rank: 2
type: bug
notes: "operating-mode-recommendation-shape e2e: agent pipeline never materializes non-empty proposedTrades on dev"
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_agent_runtime_structured_output.md, project_pipeline_trigger_gap.md]
validation_gate: null
---

# operating-mode-recommendation-shape e2e — empty proposedTrades

## Evidence

- `apps/e2e-feature-tests/src/advisory/operating-mode-recommendation-shape.e2e.test.ts` — three test cases (CONSERVATIVE, BALANCED, AGGRESSIVE) all fail at:
  - `apps/e2e-feature-tests/src/advisory/operating-mode-recommendation-shape.e2e.test.ts:186` →
    `throw new Error(`No DecisionPacket with non-empty proposedTrades materialized for tenantId=${tenantId} within ${PACKET_TIMEOUT_MS}ms`)` (240 000 ms timeout per case).
- The test's MandateSnapshot fixture (lines 119–122) was already updated in commit `b7aaf037` to the new shape `{ level, status, operatingMode, effectiveDate }` — the resplit-side adaptation is correct.
- DecisionPackets *do* materialize, but their `proposedTrades` arrays are empty. The polling loop never sees a non-empty packet within the timeout.

## Status

NOT caused by the InvestorProfile Domain Resplit. Pre-existing gap in the agent pipeline:
- See `project_agent_runtime_structured_output.md` — α prompt-discipline + β withFallback + γ assertOrchestratorOutput shipped pending validation 2026-05-06; "envelope-tune α and pre-existing memory namespace mismatch in PARKING LOT".
- See `project_pipeline_trigger_gap.md` — decision-workflow-ctrl SF execution coverage is fragile on dev.

## Cheapest next step

1. Pick one failing run, capture the resulting DecisionPacket from advisory-bff DDB, and diff its `proposedTrades` against the agent pipeline's last-known successful run.
2. Inspect AgentCore Runtime CloudWatch logs for `dev-portfolio-engine-ctrl` during the test window — likely an empty-output / fallback-to-empty-array path.
3. Cross-link with the existing structured-output workstream rather than treating this as a new investigation.
