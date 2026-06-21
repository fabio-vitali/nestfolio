---
id: broker-sim-adpt-no-sim-order-rejected-emission
status: parking
epic: order-execution-money-path
epic_role: captured
type: bug
notes: "broker-sim-adpt never emits SIM_ORDER_REJECTED — rejected sim orders escalate via the 1h SF timeout instead of a clean ORDER_REJECTED. Orthogonal to the epic happy-path."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_event_subject_contracts.md]
validation_gate: null
---

# broker-sim-adpt never emits SIM_ORDER_REJECTED (rejected orders escalate via timeout)

Surfaced during WS-3 (`broker-ctrl-order-sf-input-contract-gap`) of the order-execution money-path
epic, while reading the sim order path end-to-end.

## What

- `services/execution/broker-sim-adpt/src/services/simulation-engine.service.ts`
  `processOrderSubmitted` returns `{ status: 'REJECTED', rejectReason }` for insufficient cash,
  insufficient position, or unknown symbol — and calls `executeTrade` **only** on the FILLED path.
- `services/execution/broker-sim-adpt/src/handlers/event-listener.ts` (`SIM_ORDER_REQUESTED`
  handler) only `logger.info(...)`s the `FillResult` and returns `skip()`. It never `PutEvents` a
  `SIM_ORDER_REJECTED`, and no `VirtualTrade` row is written for a rejection (so there is no CDC
  emission either).

## Consequence

A rejected sim order produces **no callback event**. broker-ctrl's `OrderStateMachine` `RouteOrder`
is `invoke.waitForTaskToken` (300s) / `WaitForMoreFills` (15m), with a 1-hour SF timeout → the
task token is never resolved → the SF hits `HandleTimeout` and marks the order **ESCALATED**
instead of cleanly **REJECTED**. The `SIM_ORDER_REJECTED` ingress (`callback-resolver`) is wired
and ready, but nothing ever fires it.

## Why captured (not core)

The epic's `done_when` is the **happy path**: a funded dollar buy → fill → ledger records real
economics → `getPortfolio` reflects the fill, with the accept-decision e2e green. WS-3's
denomination fix means a modest funded buy fills (no rejection on the gated path), so this gap is
**orthogonal** to `done_when`. It is real production debt but does not block the epic.

## Cheapest fix direction

In the sim `SIM_ORDER_REQUESTED` handler, on a `REJECTED` `FillResult`, emit `SIM_ORDER_REJECTED`
(standard envelope, `rejectionReason` on the subject) so `callback-resolver` resolves the task
token to a deterministic `REJECTED` — mirroring the existing FILLED→`SIM_ORDER_FILLED` path.

See [[project_event_subject_contracts]].
