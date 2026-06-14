---
id: contract-emission-dry-wire-reenable
status: shipped
rank: 13
type: tooling
notes: "Surfaced 2026-06-11 by cdc-publisher-typed-subjects (WS-2). Shipped 2026-06-14: re-enabled the execution contract-emission DRY-wire capture. Scope grew from the filed 'just fix the detailType' once execution was driven against deployed dev — TWO real blockers surfaced: (1) the DRY-wire trap waited on ORDER_CREATED, which is UNREACHABLE (execution-ctrl event-listener only ever INSERTs status SUBMITTED|STAGED|REJECTED → field-dispatches to ORDER_SUBMITTED|ORDER_STAGED|ORDER_REJECTED; default ORDER_CREATED never fires) — re-armed the trap on all three (capture whichever fires, status is non-deterministic by market-hours/safety); (2) the test's DECISION_APPROVED trigger was STALE — execution-ctrl's fromDecisionApproved now parseSubject's against ComplianceCheckSchema (WS-3 consumer-retyping, 2026-06-12, shipped AFTER this test was written in WS-2), so the old {decisionPacketId,proposedTrades} payload ZodError'd → no Order row → no CDC → trap timeout (same stale payload also broke Block A it1). Fixed both via a shared approvedComplianceCheck() helper. Also de-flaked: aligned the DRY-wire window to its green ledger/investor siblings (waitForSubject 180s→300s + it-timeout 420s→600s) — 2 early failures were the 180s window exceeded by a cold/contended CDC chain (warm runs land ~52-78s; a no-tenant-filter diagnostic capture PROVED the publisher emits a correct DRY ORDER_STAGED with matching context.tenantId + prod source). Reusable: armEventSubjectTrap now accepts detailType string|string[] (wait-for-any) for status-dispatched rows; backward-compatible for single-string callers. ADVISORY DRY-wire + advisory ROW-PARSE gate remain separately tracked (sandbox-maxVms-bound, gated on agentcore-maxvms-prod-quota-increase / agentcore-invocation-resilience) — out of this item's scope. NOT re-run here (unchanged, out of changed scope): Block A it2/it3 (broker-sim) + Block B (REAL Alpaca paper)."
references: []
out_of_scope:
  - "Advisory DRY-wire it + advisory contract-emission ROW-PARSE gate (sandbox-maxVms-bound — agentcore-maxvms-prod-quota-increase / agentcore-invocation-resilience)"
  - "Block A it2/it3 (broker-sim) + Block B (REAL Alpaca paper) — unchanged, not re-run"
  - "broker-ctrl-order-sf-input-contract-gap (empty-trades order path; DECISION_APPROVED no longer carries proposedTrades)"
spec: null
plan: null
topic_memory: []
validation_gate: "Test-only change in apps/e2e-feature-tests (Simple lane, main); no deploy (detect-deploy-needed exit 10). tsc -p tsconfig.spec.json exit 0; nx lint e2e-feature-tests+nestfolio-e2e green. Scoped e2e vs deployed dev (NESTFOLIO_INTEG_PREFIX=dev): 'execution-ctrl: Order subject parses' PASS; DRY-wire 'emits a DRY Order subject (no envelope keys)' PASS 2/2 (77.9s @180s pre-align, 52.7s @300s post-align). Root cause of 2 prior timeouts confirmed (stale ComplianceCheck payload + 180s window vs cold/contended CDC chain) via CloudWatch ingress ZodError logs + a no-tenant-filter EB capture that caught the real DRY ORDER_STAGED emission (source=dev-execution-event-bus@execution-ctrl, context.tenantId matched)."
---

# Re-enable the execution contract-emission DRY-wire capture (post-WS-2)

WS-2 (`cdc-publisher-typed-subjects`) Task 10 ran the four `*-contract-emission.e2e.test.ts`
gates against deployed dev for the first time. Ledger + investor passed fully (real-row parse +
the new DRY-wire emission capture). This item's queued scope is the single actionable,
dependency-free follow-up; the maxVms-bound follow-up is tracked elsewhere (below).

## Shipped 2026-06-14 — execution DRY-wire capture re-enabled

`apps/e2e-feature-tests/src/execution/execution-contract-emission.e2e.test.ts` had a
`describe.skip`'d block `emits a DRY ORDER_CREATED subject`. Driving it against deployed dev
surfaced **two** real blockers (the filed scope had only the first, and mis-stated the fix):

1. **Unreachable detailType.** The trap waited on `ORDER_CREATED`, but the execution-ctrl
   event-listener (`processApprovedDecision`) only ever INSERTs an `Order` with `status`
   `SUBMITTED|STAGED|REJECTED`, which the Egress `eventTypes` field-dispatch maps to
   `ORDER_SUBMITTED|ORDER_STAGED|ORDER_REJECTED`. The default `ORDER_CREATED` never fires.
   Which one fires is non-deterministic (market-hours + safety), so the trap is now armed on
   all three and captures whichever the publisher emits. `armEventSubjectTrap` was widened to
   accept `detailType: string | string[]` (wait-for-any) — a reusable shape for any
   status-dispatched row; single-string callers (ledger/investor/advisory) are unchanged.

2. **Stale trigger payload.** execution-ctrl's `fromDecisionApproved` now
   `parseSubject`'s `DECISION_APPROVED` against `ComplianceCheckSchema` (WS-3 consumer-retyping,
   2026-06-12 — shipped *after* this test was written in WS-2). The test's old
   `{decisionPacketId, proposedTrades}` payload `ZodError`'d at parse → no `Order` row → no CDC →
   trap timeout. The same stale payload also broke Block A `it 1`. Both call sites now build a
   valid `ComplianceCheck` via a shared `approvedComplianceCheck()` helper (`fromDecisionApproved`
   reads only `decisionPacketId`; `proposedTrades` ride `RECOMMENDATION_PROPOSED`, so the Order
   carries `[]` — faithful to production, see `broker-ctrl-order-sf-input-contract-gap`).

3. **De-flake (window alignment).** Two early runs failed at the trap's `180s` window with an
   empty buffer — the cold/contended `putEvent → ingress → Order INSERT → DDB stream → CDC publish
   → EB` chain exceeded it. A no-tenant-filter diagnostic EB capture proved the publisher emits a
   correct DRY `ORDER_STAGED` (`source=dev-execution-event-bus@execution-ctrl`, matching
   `context.tenantId`). The green ledger/investor DRY-wire siblings already use `300s` /
   `600s`; execution was the outlier. Aligned `waitForSubject 180s→300s` + it-timeout `420s→600s`.
   Result: DRY-wire PASS 2/2 (77.9s, 52.7s); Block A `it 1` PASS.

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
