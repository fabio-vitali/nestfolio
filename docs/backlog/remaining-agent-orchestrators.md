---
id: remaining-agent-orchestrators
status: shipped
type: refactor
references: []
out_of_scope: []
spec: null
plan: null
topic_memory:
  - project_agent_orchestrators.md
validation_gate: "All 4 surviving advisory agent services use createOrchestrator + invokeOrchestrator + createAgentServer (verified 2026-05-07); advisory-ctrl was deleted 2026-04-30 in Spec 2; advisory-narrative + market-intelligence are intentionally single-agent per α/β/γ spec."
closed: "2026-05-07"
notes: "Naturally closed by Spec 2 + structured-output α/β/γ ship; no fresh workstream needed."
---

# Remaining agent orchestrators (3 of 5) — naturally closed

The original 31-day-old framing was that 2/5 advisory agent services had real orchestrators (investor-profile-ctrl + portfolio-engine-ctrl) and 3 were still on stubs (advisory-ctrl, advisory-narrative-ctrl, market-intelligence-ctrl).

Verified against current code:
- advisory-ctrl was DELETED 2026-04-30 in Spec 2 (advisory pipeline consolidation).
- The structured-output α/β/γ ship 2026-05-06 (commits `137523df`/`eff369af`/`52a22f96`) explicitly reshaped advisory-narrative + market-intelligence `graph.ts` to use `createOrchestrator` + `invokeOrchestrator` + `createAgentServer` — single-agent by design (per α/β/γ spec) but production-grade, not stubs.
- All 4 surviving advisory agent services (`grep -rn createOrchestrator services/advisory/{advisory-narrative-ctrl,investor-profile-ctrl,market-intelligence-ctrl,portfolio-engine-ctrl}/agents/`) now run through the same orchestrator path.

Done as a side-effect of Spec 2 + α/β/γ; no fresh workstream needed.
