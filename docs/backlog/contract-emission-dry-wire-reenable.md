---
id: contract-emission-dry-wire-reenable
status: queued
rank: 13
type: tooling
notes: "Surfaced 2026-06-11 by cdc-publisher-typed-subjects (WS-2). QUEUED scope (actionable, no deps): fix the execution contract-emission DRY-wire `it` `emits a DRY ORDER_CREATED subject` — it traps ORDER_CREATED, but the execution-ctrl Order row INSERTs with a status that field-dispatches to ORDER_SUBMITTED (read the Order field-dispatch in execution-ctrl/src/service.stack.ts), so the trap times out; point its detailType at the real emitted event, drop the .skip, re-run the execution gate vs deployed dev (no deploy / no agents needed). SEPARATELY TRACKED (NOT this item's scope): the advisory DRY-wire `it` + the advisory contract-emission ROW-PARSE gate are sandbox-maxVms-bound (the 4-agent decision cycle cannot reliably materialise InvestorProfileSnapshot under the deliberately-low sandbox AgentCore maxVms quota — Task-10 saw the IP agent ingress redeliver 576x without finishing; passed 7/7 in WS-1 typed-subject-contracts-advisory, so flaky not broken, orthogonal to WS-2) — gated on the maxVms work in agentcore-maxvms-prod-quota-increase / agentcore-invocation-resilience. WS-2 publisher DRY-emission correctness is established independently: a zero-contract-violation sweep across all 28 deployed egress publishers + by-construction DRY (WS-1 validated the rows parse → schema.parse(row) succeeds) + 312 unit tests."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Re-enable the execution contract-emission DRY-wire capture (post-WS-2)

WS-2 (`cdc-publisher-typed-subjects`) Task 10 ran the four `*-contract-emission.e2e.test.ts`
gates against deployed dev for the first time. Ledger + investor passed fully (real-row parse +
the new DRY-wire emission capture). This item's queued scope is the single actionable,
dependency-free follow-up; the maxVms-bound follow-up is tracked elsewhere (below).

## Queued scope — fix the execution DRY-wire `it`

`apps/e2e-feature-tests/src/execution/execution-contract-emission.e2e.test.ts` has a
`describe.skip`'d block `emits a DRY ORDER_CREATED subject`. It arms the trap on `ORDER_CREATED`,
but the execution-ctrl `Order` row INSERTs with a `status` that field-dispatches to
`ORDER_SUBMITTED` (read the Egress `eventTypes` Order field-dispatch in
`services/execution/execution-ctrl/src/service.stack.ts`), so the trap times out. Fix: point the
trap's `detailType` at the event the order actually emits (or drive an order whose status maps to
the default `ORDER_CREATED`), drop the `.skip`, and re-run the execution contract-emission gate
against deployed dev to confirm green. No deploy and no agent pipeline are involved.

## Separately tracked (NOT this item's scope) — advisory maxVms reliability

The advisory DRY-wire `it` (`DECISION_READ_MODEL_CREATED`) and the advisory contract-emission
ROW-PARSE gate (its `REAL decision cycle` describe) both need the 4-agent pipeline to materialise
an `InvestorProfileSnapshot` (`withProfileSnapshot()`), which the sandbox cannot reliably complete
under its **deliberately-low AgentCore maxVms quota** (Task-10 saw the IP-ctrl agent ingress
redeliver **576×** — throttle → SQS redrive — without finishing; the same gate passed **7/7** in
the WS-1 `typed-subject-contracts-advisory` slice, so it is flaky, not broken, and orthogonal to
WS-2). That re-enable is gated on the maxVms work tracked by `agentcore-maxvms-prod-quota-increase`
+ `agentcore-invocation-resilience` (or by pre-warming / serialising the agent fan-out so one
cycle fits the sandbox quota) — deliberately kept out of this queued item.

## WS-2 correctness (not a concern)

WS-2's publisher DRY emission is validated independently of the skipped captures: a
**zero-contract-violation sweep across all 28 deployed egress publishers** (no publisher rejects a
real row), **by-construction DRY** (WS-1 validated the rows parse against their contracts →
`schema.parse(row)` succeeds), and **312 unit tests**. This item is e2e DRY-wire capture coverage.
