---
id: alpha-vantage-economic-indicator-unconsumed
status: parking
type: bug
notes: "alpha-vantage-adpt CDC-emits ALPHA_VANTAGE_ECONOMIC_INDICATOR_UPDATED but no service subscribes to it."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: event-name-integrity
epic_role: core
---

# ALPHA_VANTAGE_ECONOMIC_INDICATOR_UPDATED has no consumer

`alpha-vantage-adpt` CDC-emits `ALPHA_VANTAGE_ECONOMIC_INDICATOR_UPDATED` (EconomicIndicator
table, insert+modify), but no service subscribes; `market-intelligence-ctrl` (the only plausible
consumer) subscribes to `ALPHA_VANTAGE_NEWS_UPDATED` only.

Evidence: `services/advisory/alpha-vantage-adpt/src/service.stack.ts:77-78`;
`market-intelligence-ctrl/src/service.stack.ts:45-51`.

Surfaced by the 2026-07-19 pre-ship deploy-gate batch for
`circuit-breaker-lifecycle-e2e-breaker-stuck-open` (audit-domain#2); filing deferred to this
session per Entry 33.
