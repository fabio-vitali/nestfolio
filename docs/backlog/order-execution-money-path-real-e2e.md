---
id: order-execution-money-path-real-e2e
status: shipped
epic: order-execution-money-path
epic_role: core
rank: null
type: tooling
notes: "WS-5 of the order-execution money-path repair (spec 2026-06-19-order-execution-money-path-design.md §5, §7). Replace the synthetic ledger-bus ORDER_FILLED injection in apps/e2e-feature-tests/src/advisory/accept-decision.e2e.test.ts with a REAL ORDER_SUBMITTED on the execution bus → real broker SF → real sim fill → real ORDER_FILLED → real ledger → getPortfolio reflects the VTI position (exercises previously-broken hops 3-8 for real, market-hours-independent). PLUS an execution-ctrl integration test: DECISION_APPROVED/USER_CONFIRMED carrying proposedTrades → N Order rows with symbol/side/amount → N ORDER_SUBMITTED (trap-asserted; covers hops 1-2). PLUS sync flows/order-execution.flow.yaml + flows/order-ledger.flow.yaml (drop the latent-gap NOTEs once the path is real). Per feedback-flake-means-broken: pull CloudWatch on any fail-then-pass before continuing. Gated behind WS-1..WS-4 deployed (the e2e drives the whole real path). Complex lane (e2e + integration + flow-spec; deploy-validated). Promote to QUEUED when WS-4 ships."
references: []
out_of_scope:
  - "Playwright full-journey assertion of confirm→portfolio (market-hours dependent) — not the CI gate per spec §5; the epic E6 Playwright run is scoped to the touched journeys only"
  - "The full real-Alpaca live decision-cycle e2e through the 24h OrderPollingStateMachine — still out. WS-5 DID bring broker-alpaca amountCents→notional order submission in scope (forced by the shared BrokerOrderRequestSchema rename); the real-Alpaca-paper contract-emission e2e covers notional placement"
  - "broker-sim-adpt SIM_ORDER_REJECTED emission (captured member broker-sim-adpt-no-sim-order-rejected-emission) — the real-path e2e drives a funded BUY that fills, not a rejection"
spec: docs/superpowers/specs/2026-06-19-order-execution-money-path-design.md
plan: docs/superpowers/plans/2026-06-21-ws5-real-path-e2e-integration-flowsync.md
topic_memory: []
validation_gate: |
  WS-5 shipped in epic-member mode (order-execution-money-path); the expensive real-path
  e2e (accept-decision scenario 6 + execution-contract-emission notional) + scoped Playwright
  are HOISTED to the epic E6 batched gate per /backlog-next-epic — they are NOT run per-member.
  Per-member gate GREEN @ 4729fb96:
  - broker-alpaca-adpt:test-integration — 2 suites / 10 tests PASS (mock-Alpaca). The resilience
    idempotency ALPACA_ORDER_REQUESTED fixture was the one fixture missed by the WS-3 quantity→amountCents
    rename; migrated this member (4729fb96), root-caused via the putEvent typed-subject schema.parse reject.
  - execution-ctrl:test-integration — 2 suites / 5 tests PASS (covers ORDER_SUBMITTED hops 1-2).
  - true-affected test+lint across 32 projects, check-typed-fixtures, read-model-drift, full e2e tsc
    compile — GREEN @ abfb3968 (tree unchanged since, only the resilience fixture added after).
  - broker-alpaca-adpt deployed to dev: ✅ dev-broker-alpaca-adpt (CFN UPDATE_COMPLETE, 43s).
  Epic-level validation_gate (real-path e2e evidence) is recorded on the epic file at E6/E7 ship.
---

# WS-5 — real-path e2e + integration + flow-spec sync

See spec §5. The accept-decision e2e drives the real execution-bus path (not synthetic injection);
execution-ctrl integration covers hops 1-2; flow specs synced. Gated behind WS-1..WS-4 deployed.
