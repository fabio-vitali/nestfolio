---
id: order-execution-money-path
status: shipped
type: epic
notes: "Delivery epic for the end-to-end order→fill→ledger money-path repair, designed in docs/superpowers/specs/2026-06-19-order-execution-money-path-design.md (design workstream order-execution-money-path-design, shipped 2026-06-19). The path has NEVER functioned in production — broker-ctrl's order SF is empirically 881/881 FAILED at ReadExecutionMode, ORDER_SUBMITTED carries empty proposedTrades, and ORDER_FILLED drops symbol/side/quantity so ledger RecordFill gets undefined economics (cash + positions never update on fills). Decisions (user-approved): (1) enrich authorizing events — DECISION_APPROVED + USER_CONFIRMED carry proposedTrades; (2) one order per trade — execution-ctrl expands to N per-symbol Orders; (3) SF composes ORDER_FILLED symbol/side from the bound order. 5 sequential-by-hop core slices; each independently deployable+dev-testable by injecting its input event; WS-5's e2e gate needs all of WS-1..WS-4 deployed. Subsumes the rank-1 ledger consumer bug (ledger-ctrl-live-tax-lot-missing-order-fields → WS-4, re-homed out of typed-subject-consumer-contract-gaps 2026-06-19) + the parked broker SF input gap (broker-ctrl-order-sf-input-contract-gap → WS-3). Parking until WS-1 is adopted via /backlog-next; members worked individually off QUEUED (WS-1 queued rank 1, successors parking, promoted as predecessors ship)."
done_when: "The real order→fill→ledger path works end-to-end: execution-ctrl emits per-trade ORDER_SUBMITTED carrying symbol/side/quantityOrAmountCents → broker SF routes (envelope-correct input) + fills → ORDER_FILLED carries symbol/side → ledger RecordFill updates cash balance + positions with real economics → getPortfolio reflects fills; the accept-decision e2e drives the REAL path (not synthetic injection) and is green; flow specs synced. Every core member shipped or dropped."
scope: "The order→fill→ledger path contracts + code across all 8 hops (advisory authorizing-event proposedTrades carriage; execution-ctrl per-trade Order expansion + ORDER_SUBMITTED enrichment; broker-ctrl SF envelope/input-contract fix + ORDER_FILLED enrichment; ledger-ctrl typed RecordFill; real-path e2e + execution-ctrl integration coverage + flow-spec sync)."
out_of_scope:
  - "The full real-Alpaca (live) decision-cycle e2e through the 24h OrderPollingStateMachine to terminal fill — still out (needs the long-poll SF). NOTE: WS-5 brought the broker-alpaca amountCents→notional order submission IN scope (the shared BrokerOrderRequestSchema rename forced it); the real-Alpaca-paper contract-emission e2e validates the notional order placement + AlpacaOrderResult contract."
  - "Agent/decision-cycle changes upstream of the proposedTrades carriage (beyond the DECISION_APPROVED/USER_CONFIRMED contract this path requires)"
  - "Non-order money paths (deposits/withdrawals/corporate-actions)"
  - "The STAGED → market-open promotion path's own e2e (StagedOrderProcessor cron)"
references: []
spec: docs/superpowers/specs/2026-06-19-order-execution-money-path-design.md
plan: null
topic_memory: [project_event_subject_contracts.md]
validation_gate: "E6 batched e2e GREEN on shipping code (branch feat/epic-order-execution-money-path @ 6095ad02), deployed to dev (broker-ctrl/broker-sim-adpt/execution-ctrl/ledger-ctrl/broker-alpaca-adpt). REAL-path accept-decision scenario 6 PASS — confirmed decision → ORDER_SUBMITTED → broker SF (sim) → fill → ORDER_FILLED → ledger RecordFill → getPortfolio reflects the VTI position with real economics (first ever end-to-end run of hops 3-8). execution-contract-emission PASS: SIM path (3), REAL Alpaca paper notional (3), DRY-wire Order subject Task 9 (1). All 5 core members shipped; flow specs (order-execution + order-ledger) synced. E6 surfaced + fixed 2 issues (this PR): (1) PRODUCTION bug — the order SF read $.executionMode.Item.mode.S unconditionally and crashed with an uncatchable States.Runtime when the ExecutionMode cache row was absent (written only at go-live → every sim-mode investor's first order failed; the documented 881/881-FAILED symptom); fixed via a Choice-on-isPresent defaulting to simulation (broker-ctrl SF, c148736b). (2) TEST bug — the DRY-wire test's DECISION_APPROVED carried no/partial proposedTrades so the event-listener correctly skip()'d (or ProposedTradeSchema rejected it); fixed by carrying a full ProposedTrade (6095ad02). Playwright skipped (logged): backend-only epic, zero touched journeys, money path covered by the Jest real-path e2e. broker-ctrl unit 85/85 + integration 11/11 green."
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
