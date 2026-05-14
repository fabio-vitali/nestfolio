---
id: portfolio-engine-service-unavailable-asymmetric-handling
status: parking
type: bug
notes: "portfolio-engine graph returns serviceUnavailable instead of throwing; other 3 advisory agents throw"
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# portfolio-engine graph.ts asymmetric serviceUnavailable handling

Surfaced during Phase A Task 7 code review (commit `5350ec6e` on `feat/inter-agent-sf-state-phase-a`).

Three of the four advisory agent graphs throw on a `serviceUnavailable` orchestrator result:
- `services/advisory/investor-profile-ctrl/agents/investor-profile/graph.ts:101-104` — throws.
- `services/advisory/market-intelligence-ctrl/agents/market-intelligence/graph.ts:97-99` — throws.
- `services/advisory/advisory-narrative-ctrl/agents/advisory-narrative/graph.ts:102-104` — throws.

The fourth, `services/advisory/portfolio-engine-ctrl/agents/portfolio-engine/graph.ts:140`, **returns** the `serviceUnavailable` shape to the caller without throwing. The diff is pre-existing — Task 7 only made it more visible by removing the `if (!('serviceUnavailable' in result))` guard that wrapped the deleted write.

Cheapest next step: align portfolio-engine to throw, OR document why portfolio's degraded path is special. If the throw is the right call, also add a graph.test.ts case asserting the throw on a fake `serviceUnavailable` result.

Non-blocking for Phase A — the agent-service degraded-output path tolerates either shape today.
