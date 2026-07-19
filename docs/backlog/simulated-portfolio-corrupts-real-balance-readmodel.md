---
id: simulated-portfolio-corrupts-real-balance-readmodel
status: parking
type: bug
notes: "ledger-bff balance-updated.ts/portfolio-updated.ts project BALANCE_UPDATED/PORTFOLIO_UPDATED into the canonical Portfolio row regardless of streamType, so advisory simulations can overwrite a real user's displayed balance."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: simulation-streamtype-guard-gap
epic_role: core
---

# Simulated portfolio events corrupt the real balance read-model

HARD-FAIL finding. `services/ledger/ledger-bff/src/transforms/balance-updated.ts:17-26` and
`portfolio-updated.ts:18-34` project `BALANCE_UPDATED`/`PORTFOLIO_UPDATED` into the canonical
`Portfolio#{tenantId}` row regardless of `streamType`, so advisory decision-packet simulations
(ledger-ctrl's `processSimulationEvent`) can overwrite a real user's displayed balance/positions.
The sibling transform `ledger-entry-recorded.ts` correctly branches on `streamType`, confirming
this is an asymmetric bug. Related: [[simulated-portfolio-poisons-reconciliation-intent-cache]],
[[decision-packet-simulation-loop-back-into-dwc-ledger-snapshot]] (same root cause: no streamType
guard on simulation-tagged PORTFOLIO_UPDATED/BALANCE_UPDATED events). Consider aggregating these 3
into a theme epic on a future `/backlog-themes` sweep.
