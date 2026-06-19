---
id: broker-alpaca-result-timestamp-drift
status: parking
type: refactor
notes: "broker-alpaca AlpacaOrderResult/AlpacaTransferResult rows carry `timestamp` (and AlpacaOrderResult `alpacaOrderId`) only on SOME writers: the repository createMapping writes timestamp; the event-listener reject/cancel/error emissions do NOT (they rely on the pipeline-injected envelope createdAt), and cancel emissions omit alpacaOrderId. Same aggregate, different field-presence per writer. The typed-subject-contracts-execution slice made `timestamp`/`alpacaOrderId` optional on the contracts to match reality. Promote when normalizing the broker-alpaca writers to a consistent emitted shape."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_event_subject_contracts.md]
validation_gate: null
epic: broker-alpaca-emission-shape-drift
epic_role: core
---

# broker-alpaca AlpacaOrderResult/AlpacaTransferResult field-presence drift

Surfaced 2026-06-10 during `typed-subject-contracts-execution` (slice 3) — typing the
event-listener emissions against the new contracts surfaced that the same aggregate is
written with different field sets by different writers.

## What

`AlpacaOrderResult` / `AlpacaTransferResult` (`__typename`-keyed rows, CDC-emitted as
`ALPACA_ORDER_*` / `ALPACA_TRANSFER_*`) are written by two kinds of writer:
- **Repositories** (`order-mapping.repository.ts` / `transfer-mapping.repository.ts` `createMapping`) — write `timestamp: getTime()`.
- **event-listener emissions** (broker-unavailable rejections, cancel results, error paths) — write NO `timestamp` (they rely on the materialize pipeline's envelope `createdAt`). The cancel emissions also omit `alpacaOrderId`.

So a CDC-emitted `ALPACA_ORDER_REJECTED` (from the event-listener) lacks the `timestamp`
business field that an `ALPACA_ORDER_PLACED` (from the repository) carries. The slice made
`timestamp` (both contracts) + `alpacaOrderId` (AlpacaOrderResult) **optional** to match
the real per-writer reality.

## Impact

Low — degrades gracefully (consumers can use the envelope `createdAt`). The contract is
honest (optional). The cleanup is consistency, not correctness.

## Fix direction

Normalize the event-listener emission writers to always include `timestamp` (and a sentinel
`alpacaOrderId` where genuinely absent), then tighten the contract fields back to required.
Runtime emission change (out of scope for the type-only contracts slice).

See [[project_event_subject_contracts]].
