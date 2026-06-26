---
id: execution-ctrl-orderrepository-prune-unused-methods
status: shipped
closed: 2026-06-26
type: refactor
notes: "Surfaced 2026-06-09 when the dead OrderLifecycleService was deleted (salvaged to main from the dropped residual-generic-subject-casts-cleanup workstream). After that delete, OrderRepository.createOrder + createStagedOrder (services/execution/execution-ctrl/src/repositories/order.repository.ts) are unused — only updateOrderStatus stays live (called by staged-order-processor.ts; the live event-listener path creates orders via the record() intent, not the repository). Promote when touching execution-ctrl's repository, or fold into a dead-code sweep. Verify zero callers (grep) before pruning."
references: []
out_of_scope:
  - "The half-dead CoolDown feature (setCoolDown zero-writers + always-null getCoolDown safety branch) — filed as its own epic member execution-ctrl-cooldown-feature-dead-code because removing it edits safety-check behavior"
  - "broker-ctrl's BrokerOrderRepository.createOrder — a different class in a different service, live (called by route-order.ts)"
spec: null
plan: null
topic_memory: []
validation_gate: "Commit 3f98432d on feat/epic-dead-code-cleanup. Grep-confirmed zero production callers before pruning createOrder + createStagedOrder + getOrder from OrderRepository (the staged-order-processor/broker-ctrl hits were createStagedOrderProcessor / a different BrokerOrderRepository). Removed: the 3 methods + unused ProposedTrade import, their unit-test blocks (renamed the misnamed 'createOrder — error paths' describe to updateOrderStatus, keeping its surviving test), and de-staled the OrderSchema comment ('PENDING' retained in the enum for backward-compat). Scope expanded from the body's 2 methods to 3 (getOrder also 0-caller dead) per logged decision; the half-dead cooldown feature split out to its own core member execution-ctrl-cooldown-feature-dead-code. 6.2 gate GREEN: `nx run-many -t test lint` across 33 true-affected projects (EXIT 0). Deploy + integration/e2e deferred to epic E6 batched gate per logged decision (behavioral no-op)."
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
