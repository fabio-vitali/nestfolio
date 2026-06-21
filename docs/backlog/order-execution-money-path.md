---
id: order-execution-money-path
status: active
type: epic
notes: "Delivery epic for the end-to-end order→fill→ledger money-path repair, designed in docs/superpowers/specs/2026-06-19-order-execution-money-path-design.md (design workstream order-execution-money-path-design, shipped 2026-06-19). The path has NEVER functioned in production — broker-ctrl's order SF is empirically 881/881 FAILED at ReadExecutionMode, ORDER_SUBMITTED carries empty proposedTrades, and ORDER_FILLED drops symbol/side/quantity so ledger RecordFill gets undefined economics (cash + positions never update on fills). Decisions (user-approved): (1) enrich authorizing events — DECISION_APPROVED + USER_CONFIRMED carry proposedTrades; (2) one order per trade — execution-ctrl expands to N per-symbol Orders; (3) SF composes ORDER_FILLED symbol/side from the bound order. 5 sequential-by-hop core slices; each independently deployable+dev-testable by injecting its input event; WS-5's e2e gate needs all of WS-1..WS-4 deployed. Subsumes the rank-1 ledger consumer bug (ledger-ctrl-live-tax-lot-missing-order-fields → WS-4, re-homed out of typed-subject-consumer-contract-gaps 2026-06-19) + the parked broker SF input gap (broker-ctrl-order-sf-input-contract-gap → WS-3). Parking until WS-1 is adopted via /backlog-next; members worked individually off QUEUED (WS-1 queued rank 1, successors parking, promoted as predecessors ship)."
done_when: "The real order→fill→ledger path works end-to-end: execution-ctrl emits per-trade ORDER_SUBMITTED carrying symbol/side/quantityOrAmountCents → broker SF routes (envelope-correct input) + fills → ORDER_FILLED carries symbol/side → ledger RecordFill updates cash balance + positions with real economics → getPortfolio reflects fills; the accept-decision e2e drives the REAL path (not synthetic injection) and is green; flow specs synced. Every core member shipped or dropped."
scope: "The order→fill→ledger path contracts + code across all 8 hops (advisory authorizing-event proposedTrades carriage; execution-ctrl per-trade Order expansion + ORDER_SUBMITTED enrichment; broker-ctrl SF envelope/input-contract fix + ORDER_FILLED enrichment; ledger-ctrl typed RecordFill; real-path e2e + execution-ctrl integration coverage + flow-spec sync)."
out_of_scope:
  - "A real-Alpaca (live) e2e — needs real keys + the 24h OrderPollingStateMachine; live correctness rides on the same typed contract + unit/contract tests"
  - "Agent/decision-cycle changes upstream of the proposedTrades carriage (beyond the DECISION_APPROVED/USER_CONFIRMED contract this path requires)"
  - "Non-order money paths (deposits/withdrawals/corporate-actions)"
  - "The STAGED → market-open promotion path's own e2e (StagedOrderProcessor cron)"
references: []
spec: docs/superpowers/specs/2026-06-19-order-execution-money-path-design.md
plan: null
topic_memory: [project_event_subject_contracts.md]
validation_gate: null
---

# Order-execution money path (epic)

Delivery epic repairing the order→fill→ledger money path end-to-end. See the design spec
`docs/superpowers/specs/2026-06-19-order-execution-money-path-design.md` §7 for the full
decomposition and break→slice mapping.

## Members (core, sequential by hop)

1. **WS-1** `advisory-authorizing-events-carry-proposed-trades` — DECISION_APPROVED (compliance-ctrl)
   + USER_CONFIRMED (advisory-bff) contracts carry `proposedTrades`.
2. **WS-2** `execution-ctrl-per-trade-order-expansion` — typed `proposedTrades`, per-trade `Order`
   expansion, `OrderSchema` + `ORDER_SUBMITTED` gain `symbol/side/quantityOrAmountCents`.
3. **WS-3** `broker-ctrl-order-sf-input-contract-gap` — SF envelope/input-contract fix (break A) +
   `MarkFilledNormalizedEvent`/`NormalizedOrderEventSchema` enrichment (break D producer).
4. **WS-4** `ledger-ctrl-live-tax-lot-missing-order-fields` — typed `RecordFill` + `event-listener`
   (break D consumer); live tax-lots get real data.
5. **WS-5** `order-execution-money-path-real-e2e` — real-path `accept-decision` e2e +
   execution-ctrl integration test + flow-spec sync.

## Closure

Ships when all 5 core members are terminal and the accept-decision e2e drives the real path green
(rule 9). Run the captured audit at close (no captured members filed yet).
