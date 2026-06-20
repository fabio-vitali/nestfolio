---
id: execution-ctrl-per-trade-order-expansion
status: shipped
epic: order-execution-money-path
epic_role: core
rank: 1
type: refactor
notes: "WS-2 of the order-execution money-path repair (spec 2026-06-19-order-execution-money-path-design.md §4 hop 2, §7; resolves break C granularity + break B). execution-ctrl: convert OrderSchema.proposedTrades from z.array(z.unknown()) to typed ProposedTrade[] (services/execution/execution-ctrl/src/domain/contracts.ts:31); read trades off the (now-enriched, WS-1) authorizing event; run safety checks; EXPAND to N Order rows (one per trade) each carrying symbol/side/quantityOrAmountCents; emit N ORDER_SUBMITTED each subject {orderId, symbol, side, quantityOrAmountCents, status} (DRY — identity in context). Preserve per-order SUBMITTED/STAGED/REJECTED branching (handlers/event-listener.ts processApprovedDecision). Per-trade expansion makes each ORDER_SUBMITTED single-symbol so the broker SF's existing single-instrument model fits unchanged (that is how break C is resolved). Idempotency must key on per-trade orderId. Complex lane (execution-ctrl contract + handler + deploy + integration). WS-1 SHIPPED 2026-06-19 (main a5796f03) — DECISION_APPROVED + USER_CONFIRMED now carry proposedTrades (opaque), so this is unblocked: execution-ctrl reads them off the authorizing event it already consumes. Next money-path slice (rank 1)."
references: []
out_of_scope:
  - "WS-3: broker-ctrl OrderStateMachine envelope/JSONPath fix (break A) + MarkFilledNormalizedEvent/NormalizedOrderEventSchema symbol/side enrichment (break D producer) — incl. route-order.ts + BrokerOrderSchema.requestedQty amount-vs-shares denomination alignment."
  - "WS-4: ledger-ctrl RecordFill / event-listener typed reads + cast removal (break D consumer)."
  - "WS-5: real-path accept-decision e2e (real ORDER_SUBMITTED → broker SF → fill → ledger) + flows/order-execution.flow.yaml & order-ledger.flow.yaml sync."
  - "Agent/decision-cycle changes upstream of proposedTrades carriage (WS-1, shipped) — execution-ctrl only reads the now-enriched authorizing event."
  - "Non-order money paths (deposits/withdrawals/corporate-actions)."
  - "StagedOrderProcessor scheduled market-open promotion e2e (its contract gains per-order STAGED rows here, but the cron promotion is not e2e-gated)."
spec: docs/superpowers/specs/2026-06-19-order-execution-money-path-design.md
plan: docs/superpowers/plans/2026-06-20-ws2-execution-ctrl-per-trade-order-expansion.md
topic_memory: []
validation_gate: "SHIPPED 2026-06-20 (worktree branch worktree-ws2-per-trade-order-expansion, merged to main). Implementation commits: 192b8209 (SafetyChecksService→instruments:string[]), ebd116a0 (per-trade expansion core: OrderSchema/StagedOrderSchema carry symbol/side/quantityOrAmountCents; event-listener parses authorizing-event proposedTrades→ProposedTrade[] and emits N Order rows keyed Order#tenant#${eventId}#${index}; per-trade safety + independent SUBMITTED/STAGED/REJECTED fate; zero-trades→skip(); dead OrderSubmittedSchema deleted), acea8953/c8dd7037 (per-trade CDC integration test), 4413e5b0 (service card). VALIDATION: unit 58/58 green + execution-ctrl:typecheck + lint 0-err (6.2 affected gate green incl. e2e-apps lint = no consumer type-break). Deployed dev-execution-ctrl ✅ (3 Lambdas). Integration GREEN on deployed dev: 2 suites/5 tests, 0 timeouts — DECISION_APPROVED expands to 2 per-symbol ORDER_STAGED, USER_CONFIRMED to 1, asserting symbol/side/quantityOrAmountCents; DDB-verified per-trade Order rows. Final whole-branch review (opus): READY TO MERGE, 0 Critical/0 Important. Two test-fixture regressions WS-2 caused were repaired in-scope: resilience suite (253c360d: trade-less injections + stale ${eventId} pk) and the USER_CONFIRMED trap-tenantId mismatch (7b9fd84b). Broker SF remains broken until WS-3 (expected — slice is independently deployable). Side-finding filed: EXECUTION_PAUSED/RESUMED declared-but-unwired."
---

# WS-2 — execution-ctrl per-trade order expansion

See spec §4 hop 2 + §3 (amount denomination). Expand `proposedTrades` into N per-symbol `Order`
rows; each emits a single-symbol `ORDER_SUBMITTED`. WS-1 shipped (main a5796f03) — the authorizing
events now carry `proposedTrades`, so this is unblocked and queued as the next money-path slice.
