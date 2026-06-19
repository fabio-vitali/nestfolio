---
id: order-execution-money-path-design
status: shipped
type: design
notes: "Design workstream (Doc-layer): repair the end-to-end order-execution money path, which empirical evidence (2026-06-19) shows has NEVER functioned in production. The broker-ctrl OrderStateMachine FAILS at its first state for 100% of real orders (dev: 881/881 FAILED, all `States.Runtime` at ReadExecutionMode — `$.tenantId` not found because the real ORDER_SUBMITTED carries identity under `$.context`, order data under `$.subject`, NOT top-level), and the observed ORDER_SUBMITTED subject carries `proposedTrades: []` (empty) — so even past ReadExecutionMode there is no trade data to route. Downstream, even a successful fill would emit a minimal NormalizedOrderEvent (orderId/executionMode/filledQty/averageFillPrice/timestamp) with NO symbol/side/quantity, so ledger-ctrl's RecordFill reducer reads undefined economics → cash balance + positions never updated on fills. This design produces a spec in docs/superpowers/specs/ that defines the canonical command→SF→normalized-event→read-model money-path pattern end-to-end and decomposes it into sequential implementation workstreams (each its own Complex backlog item). SUBSUMES the consumer half (ledger-ctrl-live-tax-lot-missing-order-fields, currently QUEUED rank 1) and the producer half (broker-ctrl-order-sf-input-contract-gap, currently parking); both will be re-homed into the implementation epic minted when this spec ships. Scope decided by user 2026-06-19 (Full money-path design) over the narrow ledger-contract-only and SF-root-cause-first alternatives, on reusability grounds. DESIGN PHASE IS DOC-LAYER — implementation is separate Complex work."
references:
  - services/execution/broker-ctrl/src/state-machine/order-state-machine.ts
  - services/execution/broker-ctrl/src/handlers/callback-resolver.ts
  - services/execution/broker-ctrl/src/domain/contracts.ts
  - services/ledger/ledger-ctrl/src/domain/account.reducer.ts
  - services/ledger/ledger-ctrl/src/handlers/event-listener.ts
  - apps/e2e-feature-tests/src/advisory/accept-decision.e2e.test.ts
  - docs/backlog/ledger-ctrl-live-tax-lot-missing-order-fields.md
  - docs/backlog/broker-ctrl-order-sf-input-contract-gap.md
out_of_scope:
  - "Implementation of the fix — produces only the spec doc + decomposition; each implementation slice is a separate Complex worktree workstream filed when this ships"
  - "Re-homing of subsumed items into the implementation epic — done at spec-ship time, not during design"
  - "Non-order money paths (deposits/withdrawals/corporate-actions) — those funding paths are separate; this design is scoped to the order→fill→ledger path"
  - "Bedrock/agent or decision-cycle changes upstream of execution-ctrl ORDER_SUBMITTED emission (beyond defining the ORDER_SUBMITTED contract this path requires)"
spec: docs/superpowers/specs/2026-06-19-order-execution-money-path-design.md
plan: null
topic_memory: []
validation_gate: "Spec written, self-reviewed, user-approved; committed 97db0e11 (docs/superpowers/specs/2026-06-19-order-execution-money-path-design.md). Empirically grounded: dev broker-ctrl order SF 881/881 FAILED at ReadExecutionMode (States.Runtime, $.tenantId not found — identity under $.context). Decomposed into delivery epic order-execution-money-path (5 core members — WS-1 advisory-authorizing-events-carry-proposed-trades queued rank 1; WS-2 execution-ctrl-per-trade-order-expansion; WS-3 broker-ctrl-order-sf-input-contract-gap; WS-4 ledger-ctrl-live-tax-lot-missing-order-fields; WS-5 order-execution-money-path-real-e2e — WS-2..WS-5 parking, promoted as predecessors ship). Subsumed items re-homed (ledger-ctrl-live-tax-lot out of typed-subject-consumer-contract-gaps; broker-ctrl-order-sf-input-contract-gap from standalone parking). Doc-layer, no deploy; backlog-lint 11/11 green."
---

# Order-execution money path — end-to-end repair (design)

## Why this exists

The rank-1 ledger item (`ledger-ctrl-live-tax-lot-missing-order-fields`) was the **consumer half**
of a money-path bug. Empirical investigation on dev (2026-06-19, `/backlog-next`) confirmed the
**producer half** (`broker-ctrl-order-sf-input-contract-gap`, previously only statically suspected)
is real and total:

- `dev-broker-ctrl-orderstatemachine`: **881/881 executions FAILED**, every one at the first state
  `ReadExecutionMode` with `States.Runtime` — `States.Format('ExecutionMode#{}', $.tenantId)` →
  *"`$.tenantId` could not be found"*.
- The real `ORDER_SUBMITTED` SF input is the standard envelope:
  `{ type:'ORDER_SUBMITTED', subject:{ orderId, decisionPacketId, proposedTrades:[], status }, context:{ tenantId, userId, region } }`.
  The SF reads `$.tenantId` / `$.symbol` / `$.side` / `$.quantity` at the top — none exist there.
- `proposedTrades` was observed **empty** — even a fixed input contract has nothing to route.
- Even a successful fill emits a minimal `NormalizedOrderEvent` (no symbol/side/quantity), so
  `ledger-ctrl` `RecordFill` reads `undefined` economics → **cash balance + positions never update on fills.**

The whole path — execution-ctrl `ORDER_SUBMITTED` → broker-ctrl order SF → adapter fill →
`ORDER_FILLED` → ledger-ctrl reducer → portfolio read model — **has never worked end-to-end.**

## What this design produces

A spec in `docs/superpowers/specs/` that:
1. Establishes the real shapes empirically (ORDER_SUBMITTED, adapter result, BrokerOrder state row).
2. Defines the corrected contracts and SF input/routing for each hop.
3. Defines a **reusable** command→SF→normalized-event→read-model money-path pattern.
4. Decomposes into sequential implementation workstreams (each a Complex backlog item) and the
   implementation epic that holds them — subsuming the two halves above.
5. Specifies a real-path e2e (replacing the current synthetic ledger-bus injection in
   `accept-decision.e2e.test.ts`) that drives execution end-to-end.

## Out of scope

See `out_of_scope:` frontmatter — implementation, re-homing, non-order money paths, and upstream
agent/decision changes beyond defining the ORDER_SUBMITTED contract this path needs.
