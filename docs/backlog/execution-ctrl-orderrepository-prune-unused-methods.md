---
id: execution-ctrl-orderrepository-prune-unused-methods
status: active
type: refactor
notes: "Surfaced 2026-06-09 when the dead OrderLifecycleService was deleted (salvaged to main from the dropped residual-generic-subject-casts-cleanup workstream). After that delete, OrderRepository.createOrder + createStagedOrder (services/execution/execution-ctrl/src/repositories/order.repository.ts) are unused — only updateOrderStatus stays live (called by staged-order-processor.ts; the live event-listener path creates orders via the record() intent, not the repository). Promote when touching execution-ctrl's repository, or fold into a dead-code sweep. Verify zero callers (grep) before pruning."
references: []
out_of_scope:
  - "The half-dead CoolDown feature (setCoolDown zero-writers + always-null getCoolDown safety branch) — filed as its own epic member execution-ctrl-cooldown-feature-dead-code because removing it edits safety-check behavior"
  - "broker-ctrl's BrokerOrderRepository.createOrder — a different class in a different service, live (called by route-order.ts)"
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: dead-code-cleanup
epic_role: core
---

# Prune unused OrderRepository methods

The delete of the dead `OrderLifecycleService` (now on `main`) removed the only caller of
`OrderRepository.createOrder` and `createStagedOrder`. The live order path
(`handlers/event-listener.ts`) creates `Order` / `StagedOrder` rows via the event-processor
`record()` intent, not the repository. Only `updateOrderStatus` remains live
(`staged-order-processor.ts`).

Prune `createOrder` + `createStagedOrder` (and any now-dead helpers) after grep-confirming zero
callers. Small, low-risk dead-code removal.
