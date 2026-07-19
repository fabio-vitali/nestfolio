---
id: investor-adpt-stale-cross-domain-forwards
status: parking
type: bug
notes: "investor-adpt forwards 5 cross-domain events onto InvestorBus that no investor service consumes anymore, stale since dashboard-bff's WS-3 Ingress trim."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# investor-adpt stale cross-domain forwards

`investor-adpt` forwards 5 cross-domain events onto `InvestorBus` that no investor service
consumes (they land and die): `EXPLANATION_GENERATED`, `ORDER_STAGED`, `ORDER_CANCELLED`,
`LEDGER_PROCESSING_FAILED`, `PORTFOLIO_DRIFT_DETECTED`. `dashboard-bff` removed
`ORDER_*`/`PORTFOLIO_DRIFT_DETECTED` from its Ingress (WS-3), leaving the adapter forwards stale.

Evidence: `services/investor/investor-adpt/src/service.stack.ts:41,64,67,102,103`; none appear in
Ingress `eventTypes` of investor-ctrl/investor-bff/dashboard-bff.

The `ORDER_STAGED` leg of this finding (`service.stack.ts:64`) is the same fact independently
surfaced by `audit-system-arch-docs#0-4` as its orphan-forward finding #4 ("investor-adpt forwards
ORDER_STAGED... no flow documents the hop") — deduplicated here rather than filed twice; also add
"no flow documents the hop" to this item's scope for that leg.

Surfaced by the 2026-07-19 pre-ship deploy-gate batch for
`circuit-breaker-lifecycle-e2e-breaker-stuck-open` (audit-domain#6, dedup'd with
audit-system-arch-docs#4); filing deferred to this session per Entry 33.
