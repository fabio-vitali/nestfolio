---
id: vestigial-memorystrategy-decision-workflow-ctrl
status: parking
type: refactor
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
notes: "5 MemoryStrategy entries in service.stack.ts that are no longer fed."
---

# Vestigial MemoryStrategy declarations in decision-workflow-ctrl

`services/advisory/decision-workflow-ctrl/src/service.stack.ts:36-78` declares 5 `MemoryStrategy` entries (`/portfolio-engine/{actorId}/rationale`, `/advisory-narrative/{actorId}/preferences`, etc.) that are no longer fed. Spec 2 (2026-04-30) replaced the `CreateEvent` + `RetrieveMemoryRecords` path that strategies process events for; the current `libs/agent-orchestrator/src/memory/memory-client.ts:43,60` uses `BatchCreateMemoryRecordsCommand` + `ListMemoryRecordsCommand` directly against `/{upstreamService}/{tenantId}/decisions/{decisionId}`. Strategies are provisioned but never receive input. Either remove or repurpose. Low priority — misleading-but-functional.
