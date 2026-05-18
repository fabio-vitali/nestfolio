---
id: scenario-12-rebalance-on-drift-missing-mandate-fixture
status: queued
rank: 11
type: bug
notes: "Reopened 2026-05-18 after fresh e2e run RED on main. The 2026-05-16 fixture fix (adding withLiveDecision() before the drift event) is still structurally correct — it materialises MandateSnapshot for the drift-event SF. Today's failure is on a different cycle: withLiveDecision()'s OWN prep SF fails with the same States.Runtime defect class that bit operating-mode-shape today, but on LookupInvestorProfileSnapshot. The InvestorProfileSnapshot CDC projection has not caught up when MANDATE_SNAPSHOT_CREATED triggers the SF on a fresh tenant. Fix is in decision-state-machine.ts, not in the test."
references:
  - apps/e2e-feature-tests/src/advisory/rebalance-on-drift.e2e.test.ts
  - apps/e2e-feature-tests/src/helpers/fixtures.ts
  - services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts
out_of_scope:
  - "Changing the SF LookupMandateSnapshot to tolerate missing operatingMode (would mask a real propagation failure; the May-16 fix is correct for that branch)"
  - "Test-side retry of withLiveDecision() — the SF must not raise States.Runtime on absent snapshot rows; fixing it test-side masks the prod-relevant race"
spec: null
plan: null
topic_memory:
  - project_e2e_feature_tests.md
  - project_investor_profile_collapse.md
validation_gate: null
---

# scenario-12 rebalance-on-drift — `withLiveDecision()` prep cycle fails on InvestorProfileSnapshot race (regression 2026-05-18)

## Why this is reopened (the May-16 ship is NOT being reverted)

The 2026-05-16 fix added `withLiveDecision()` to `beforeEach` so the MandateSnapshot row exists before `PORTFOLIO_DRIFT_DETECTED` fires. That fix was correct and remains in place — it solved the MandateSnapshot race for the drift-event SF.

Today's failure is on a **different SF execution**: `withLiveDecision()` itself never produces a DecisionPacket within 180s, because the prep-cycle SF (triggered by MANDATE_SNAPSHOT_CREATED) fails on the *InvestorProfileSnapshot* lookup before any agent runs. Test error:

```
waitForGraphQL timed out after 180000ms. Last result: {"getDecisionHistory":{"items":[],"nextCursor":null}}
  at applyFixtures (src/helpers/fixtures.ts:50:20)
  at Object.<anonymous> (src/advisory/rebalance-on-drift.e2e.test.ts:29:5)
```

`fixtures.ts:302` is the `waitForGraphQL` inside `withLiveDecision()` — `getDecisionHistory.items=[]` means no decision was ever materialised in advisory-bff.

## Today's evidence (CloudWatch / Step Functions)

The prep-cycle SF for the rebalance tenant fails in ~155–232 ms with `States.Runtime`, identical to the operating-mode-shape failures (rank 10). The DDB `GetItem` for `InvestorProfileSnapshot#<tenant>#<user>` returns `{}` (no `Item` key) because the snapshot projection has not caught up when `MANDATE_SNAPSHOT_CREATED` triggers the decision-state-machine. The `ResultSelector` extraction of `$.Item.agentOutput.M` then raises `States.Runtime` and the execution dies before any agent invocation.

Without a DecisionPacket, advisory-bff has nothing to project; `getDecisionHistory.items=[]` for the full 180s window; `withLiveDecision()` throws; `applyFixtures` throws; the `it()` never runs.

## Root cause (same as rank 10)

`services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts:331-352` — `LookupInvestorProfileSnapshot` uses `arn:aws:states:::dynamodb:getItem` with a `ResultSelector` that extracts `$.Item.agentOutput.M`. When the snapshot row is absent (CDC race), the JSONPath fails synchronously with `States.Runtime`. Per `feedback_states_runtime_uncatchable.md`, `States.Runtime` is not catchable — the only correct pattern is a `Choice` on `isPresent($.Item)` before any `ResultSelector` reaches into the response. The Market branch (lines 395-425) already implements this correctly.

## Cheapest fix

Same fix as rank 10: mirror the Market branch's `Choice`-on-`isPresent` pattern for `LookupInvestorProfileSnapshot`. One SF source change in `decision-state-machine.ts` resolves both this item and `operating-mode-shape-empty-proposed-trades` (rank 10).

No test-side change is required. The May-16 `withLiveDecision()` fixture fix stays as-is.

## Historical context (May 16 ship, still valid)

Original symptom (2026-05-15): scenario 12 timed out at 240s because the test's `beforeEach` did not publish `MANDATE_ISSUED`, so the drift-event SF found no MandateSnapshot row and failed at `LookupMandateSnapshot` with `States.Runtime` on `$.Item.operatingMode.S`.

May-16 fix: added `withLiveDecision()` to the fixtures list, dropped the stale `advisory-ctrl` from `targetService`. Validation: scenario 12 passed in 148s on 2026-05-16 (SF execution `6c4559d0` was the failing one before the fix).

That fix correctly addresses the MandateSnapshot race for the drift-event SF. It is NOT the bug being reopened today — today's bug is on the InvestorProfileSnapshot race inside the prep cycle, which is in the SF source, not in the test.
