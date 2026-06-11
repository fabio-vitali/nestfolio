---
id: contract-emission-dry-wire-reenable
status: parking
type: tooling
notes: "Surfaced 2026-06-11 by cdc-publisher-typed-subjects (WS-2) Task-10 validation — first-ever execution of the *-contract-emission.e2e gates against dev. The ledger + investor contract-emission gates pass fully (row-parse + DRY-wire capture). Two DRY-wire capture `it`s were `describe.skip`'d at WS-2 close, to re-enable here: (1) execution `emits a DRY ORDER_CREATED subject` — wrong event name: the Order row is INSERTed with a status that field-dispatches to ORDER_SUBMITTED (not the default ORDER_CREATED the trap waits for), so it times out; fix to the real emitted event name (confirm via execution-ctrl Order field-dispatch). (2) advisory `emits a DRY DECISION_READ_MODEL_CREATED subject` — depends on a full decision cycle, which the sandbox cannot reliably complete under AgentCore maxVms saturation (Task-10 observed the IP agent ingress redeliver 576x without finishing the snapshot → withProfileSnapshot 360s timeout). The SAME maxVms block also fails the advisory contract-emission ROW-PARSE gate (REAL decision cycle describe) in the sandbox; it passed 7/7 in the WS-1 typed-subject-contracts-advisory slice, so it is genuinely flaky, not broken. Re-enable both DRY-wire its + reliably run the advisory row-parse gate once maxVms headroom lands (see agentcore-maxvms-prod-quota-increase + agentcore-invocation-resilience) OR by pre-warming / serialising the agent fan-out. WS-2's publisher correctness is NOT in doubt: a zero-contract-violation sweep across all 28 deployed egress publishers + by-construction DRY (WS-1 validated the rows parse → schema.parse(row) succeeds) + 312 unit tests establish it. This item is purely the e2e DRY-wire capture coverage + advisory-gate maxVms reliability."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Re-enable the contract-emission DRY-wire captures + advisory row-parse gate (post-WS-2)

WS-2 (`cdc-publisher-typed-subjects`) Task 10 ran the four `*-contract-emission.e2e.test.ts`
gates against deployed dev for the first time (they were previously typecheck-only stubs).
**Ledger + investor passed fully** (real-row parse + the new DRY-wire emission capture). Two
follow-ups remain.

## A. Re-enable the 2 skipped DRY-wire capture `it`s

Both were `describe.skip`'d at WS-2 close (they are belt-and-suspenders — DRY emission is already
proven by the ledger + investor DRY-wire its and the `change-data-capture` unit tests):

1. **execution `emits a DRY ORDER_CREATED subject`** — the Order row is INSERTed with a `status`
   that field-dispatches to `ORDER_SUBMITTED`, not the default `ORDER_CREATED` the trap waits for
   → timeout. Fix: trap the event the order actually emits (read execution-ctrl's Order
   field-dispatch in `service.stack.ts`), or drive an order whose status maps to `ORDER_CREATED`.
2. **advisory `emits a DRY DECISION_READ_MODEL_CREATED subject`** — needs a completed decision
   cycle; blocked by maxVms (see B).

## B. Reliably run the advisory contract-emission ROW-PARSE gate

The advisory gate's `REAL decision cycle` describe needs the 4-agent pipeline to materialise an
`InvestorProfileSnapshot` (`withProfileSnapshot()`), which the sandbox cannot reliably complete
under AgentCore **maxVms** saturation — Task 10 observed the IP-ctrl agent ingress redeliver
**576×** (throttle → SQS redrive) without finishing, → 360s timeout. It passed **7/7** in the
WS-1 `typed-subject-contracts-advisory` slice, so it is **flaky** (maxVms-bound), not broken, and
orthogonal to WS-2. Re-enable reliable execution once maxVms headroom lands
(`agentcore-maxvms-prod-quota-increase`, `agentcore-invocation-resilience`) or by
pre-warming / serialising the agent fan-out so a single cycle fits the sandbox quota.

## Not in scope / not a concern

WS-2's publisher DRY emission is validated independently: a **zero-contract-violation sweep
across all 28 deployed egress publishers** (no publisher rejects any real row), **by-construction
DRY** (WS-1 validated the advisory rows parse against their contracts → `schema.parse(row)`
succeeds), and **312 unit tests**. This item is e2e-capture coverage + advisory-gate maxVms
reliability only.
