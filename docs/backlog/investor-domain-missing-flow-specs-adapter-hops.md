---
id: investor-domain-missing-flow-specs-adapter-hops
status: shipped
type: doc
notes: "Five real investor-adpt cross-domain forwards (ADVISORY_STATUS_UPDATED, DECISION_PACKET_UPDATED, DEPOSIT_REQUESTED/SETTLED/FAILED) have live consumers but no flow spec documents the hop."
references:
  - flows/deposit.flow.yaml
  - flows/advisory-cycle.flow.yaml
out_of_scope:
  - Reconciling the ACH bank-link relationshipId placeholder in broker-ctrl's live routeDeposit (unrelated pre-existing gap noted in that file's own comment).
spec: null
plan: null
topic_memory: []
closed: 2026-07-19
validation_gate: "flows/advisory-cycle.flow.yaml: added cross_domain blocks for DECISION_PACKET_UPDATED->InvestorBus (dashboard-bff awaitingConfirmationActivity, event-listener.ts:46) and ADVISORY_STATUS_UPDATED->InvestorBus (dashboard-bff advisoryStatus, event-listener.ts:40). flows/deposit.flow.yaml: added the DEPOSIT_REQUESTED/DETECTED/SETTLED/FAILED cross_domain hops to investor-bff's depositLifecycle projection (deposit-lifecycle.ts, versioned Deposit read model), plus the broker-ctrl DEPOSIT_FAILED emission step (deposit-withdrawal-normalizer.ts alpacaTransferFailed) that was previously undocumented entirely. Evidenced against services/investor/investor-adpt/src/service.stack.ts:40,44,68,70,71; services/investor/dashboard-bff/src/handlers/event-listener.ts:40,46; services/investor/investor-bff/src/handlers/event-listener.ts:26,30,32; services/investor/investor-bff/src/transforms/deposit-lifecycle.ts; services/execution/broker-ctrl/src/handlers/deposit-withdrawal-router.ts and deposit-withdrawal-normalizer.ts. Doc-layer lane, no code changed, no deploy/e2e gate. Committed on main."
---

# Missing flow specs for investor-adpt adapter hops

Five cross-domain events forwarded by `investor-adpt` have real investor-domain consumers but no
flow spec documents the adapter forwarding hop: `ADVISORY_STATUS_UPDATED` and
`DECISION_PACKET_UPDATED` (consumed by `dashboard-bff`), and
`DEPOSIT_REQUESTED`/`DEPOSIT_SETTLED`/`DEPOSIT_FAILED` (consumed by `investor-bff`
deposit-lifecycle transform). `deposit.flow.yaml` traces only `DEPOSIT_DETECTED`→`dashboard-bff`
and `DEPOSIT_SETTLED`→`ledger`; the entire deposit-failure branch is undocumented.

Evidence: `services/investor/investor-adpt/src/service.stack.ts:40,44,68,70,71`; consumers
`services/investor/dashboard-bff/src/handlers/event-listener.ts:40,46` and
`services/investor/investor-bff/src/handlers/event-listener.ts:26,30,32`; no `cross_domain` block
for these in `flows/deposit.flow.yaml` or `flows/advisory-cycle.flow.yaml`.

Surfaced by the 2026-07-19 pre-ship deploy-gate batch for
`circuit-breaker-lifecycle-e2e-breaker-stuck-open` (audit-system-arch-docs#3); filing deferred to
this session per Entry 33.
