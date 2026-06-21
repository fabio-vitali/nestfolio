---
id: order-execution-money-path-real-e2e
status: active
epic: order-execution-money-path
epic_role: core
rank: null
type: tooling
notes: "WS-5 of the order-execution money-path repair (spec 2026-06-19-order-execution-money-path-design.md §5, §7). Replace the synthetic ledger-bus ORDER_FILLED injection in apps/e2e-feature-tests/src/advisory/accept-decision.e2e.test.ts with a REAL ORDER_SUBMITTED on the execution bus → real broker SF → real sim fill → real ORDER_FILLED → real ledger → getPortfolio reflects the VTI position (exercises previously-broken hops 3-8 for real, market-hours-independent). PLUS an execution-ctrl integration test: DECISION_APPROVED/USER_CONFIRMED carrying proposedTrades → N Order rows with symbol/side/amount → N ORDER_SUBMITTED (trap-asserted; covers hops 1-2). PLUS sync flows/order-execution.flow.yaml + flows/order-ledger.flow.yaml (drop the latent-gap NOTEs once the path is real). Per feedback-flake-means-broken: pull CloudWatch on any fail-then-pass before continuing. Gated behind WS-1..WS-4 deployed (the e2e drives the whole real path). Complex lane (e2e + integration + flow-spec; deploy-validated). Promote to QUEUED when WS-4 ships."
references: []
out_of_scope:
  - "Playwright full-journey assertion of confirm→portfolio (market-hours dependent) — not the CI gate per spec §5; the epic E6 Playwright run is scoped to the touched journeys only"
  - "A real-Alpaca (live) e2e — out of the epic (needs real keys + the 24h OrderPollingStateMachine)"
  - "broker-sim-adpt SIM_ORDER_REJECTED emission (captured member broker-sim-adpt-no-sim-order-rejected-emission) — the real-path e2e drives a funded BUY that fills, not a rejection"
spec: docs/superpowers/specs/2026-06-19-order-execution-money-path-design.md
plan: docs/superpowers/plans/2026-06-21-ws5-real-path-e2e-integration-flowsync.md
topic_memory: []
validation_gate: null
---

# WS-5 — real-path e2e + integration + flow-spec sync

See spec §5. The accept-decision e2e drives the real execution-bus path (not synthetic injection);
execution-ctrl integration covers hops 1-2; flow specs synced. Gated behind WS-1..WS-4 deployed.
