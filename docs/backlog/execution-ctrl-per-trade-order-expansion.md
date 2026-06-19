---
id: execution-ctrl-per-trade-order-expansion
status: parking
epic: order-execution-money-path
epic_role: core
rank: null
type: refactor
notes: "WS-2 of the order-execution money-path repair (spec 2026-06-19-order-execution-money-path-design.md §4 hop 2, §7; resolves break C granularity + break B). execution-ctrl: convert OrderSchema.proposedTrades from z.array(z.unknown()) to typed ProposedTrade[] (services/execution/execution-ctrl/src/domain/contracts.ts:31); read trades off the (now-enriched, WS-1) authorizing event; run safety checks; EXPAND to N Order rows (one per trade) each carrying symbol/side/quantityOrAmountCents; emit N ORDER_SUBMITTED each subject {orderId, symbol, side, quantityOrAmountCents, status} (DRY — identity in context). Preserve per-order SUBMITTED/STAGED/REJECTED branching (handlers/event-listener.ts processApprovedDecision). Per-trade expansion makes each ORDER_SUBMITTED single-symbol so the broker SF's existing single-instrument model fits unchanged (that is how break C is resolved). Idempotency must key on per-trade orderId. Complex lane (execution-ctrl contract + handler + deploy + integration). Gated behind WS-1 (needs proposedTrades on the authorizing event); promote to QUEUED when WS-1 ships."
references: []
out_of_scope: []
spec: docs/superpowers/specs/2026-06-19-order-execution-money-path-design.md
plan: null
topic_memory: []
validation_gate: null
---

# WS-2 — execution-ctrl per-trade order expansion

See spec §4 hop 2 + §3 (amount denomination). Expand `proposedTrades` into N per-symbol `Order`
rows; each emits a single-symbol `ORDER_SUBMITTED`. Gated behind WS-1.
