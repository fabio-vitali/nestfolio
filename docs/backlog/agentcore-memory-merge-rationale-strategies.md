---
id: agentcore-memory-merge-rationale-strategies
status: queued
rank: 5
type: refactor
notes: "Merge duplicate PortfolioRationaleArchivist + NarrativeRationaleArchivist; ~$15/mo savings"
references: []
out_of_scope: []
spec: null
plan: null
topic_memory:
  - project_agentcore_cost_safeguards.md
  - project_inter_agent_state_handoff.md
validation_gate: null
---

# Merge duplicate rationale MemoryStrategies

## Evidence

`PortfolioRationaleArchivist` and `NarrativeRationaleArchivist` (`services/advisory/decision-workflow-ctrl/src/service.stack.ts` lines ~98-141) have identical extraction prompts and schemas. They exist as two strategies only because AgentCore enforces one namespace per strategy:

- `/portfolio-engine-ctrl/{actorId}/rationale`
- `/advisory-narrative-ctrl/{actorId}/rationale`

Each fires its own Haiku extraction per event, doing the same work twice per advisory cycle.

## Change

Two viable options:

1. **Merge under one namespace** like `/rationale/{actorId}/{producerService}` — keeps producer attribution as a record attribute instead of a namespace dimension. Requires updating `MemoryClient.emitLongTermEvent` callers in `portfolio-engine-ctrl/src/agent-service.ts` and `advisory-narrative-ctrl/src/agent-service.ts` to write under the merged namespace.
2. **Drop one strategy** if the rationale from one producer is sufficient for downstream recall (TBD which — portfolio or narrative is more load-bearing).

## Expected impact

- Halves rationale-extraction Haiku calls per advisory cycle.
- Estimated savings ~$15/mo.
- Should be done together with [[agentcore-memory-consolidation-off]] so the consolidation removal applies cleanly to the merged namespace.

## Risk

Low if no agent currently retrieves rationale by namespace path (verified via grep for `MemoryClient.retrieve` / `searchMemoryItems` — nothing references either rationale namespace at retrieval time today). If a future agent reads rationale, the merge approach is preferred over dropping a producer.
