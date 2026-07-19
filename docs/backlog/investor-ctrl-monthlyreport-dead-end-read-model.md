---
id: investor-ctrl-monthlyreport-dead-end-read-model
status: parking
type: bug
notes: "investor-ctrl writes+CDC-emits MonthlyReport rows nothing reads; MONTHLY_REPORT_GENERATED is a declared-but-unemitted dead constant."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: event-name-integrity
epic_role: core
---

# MonthlyReport is a dead-end read model

`investor-ctrl` writes `MonthlyReport` rows on `ORDER_FILLED` and CDC-emits
`MONTHLY_REPORT_CREATED`/`MONTHLY_REPORT_UPDATED`, but no service subscribes and no GraphQL query
reads `MonthlyReport`. `MONTHLY_REPORT_GENERATED` is a declared-but-unemitted dead constant.

Evidence: `services/investor/investor-ctrl/src/service.stack.ts:42-45`; grep `MonthlyReport` over
`services/investor/**/*.{graphql,vtl,js,ts}` finds no BFF reader.

Surfaced by the 2026-07-19 pre-ship deploy-gate batch for
`circuit-breaker-lifecycle-e2e-breaker-stuck-open` (audit-domain#5); filing deferred to this
session per Entry 33.
