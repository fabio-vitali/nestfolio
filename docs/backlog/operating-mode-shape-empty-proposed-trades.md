---
id: operating-mode-shape-empty-proposed-trades
status: active
type: bug
notes: "Reopened 2026-05-18 after fresh e2e run RED on main. BALANCED + AGGRESSIVE timed out at 360s polling for non-empty proposedTrades; CONSERVATIVE passed by timing luck. Root cause is NOT empty proposedTrades materialisation — it is a fail-closed SF JSONPath: LookupInvestorProfileSnapshot raises States.Runtime when the InvestorProfileSnapshot projection has not caught up by the time MANDATE_SNAPSHOT_CREATED triggers the decision-state-machine. Same defect class as the LookupMandateSnapshot Catch-on-Runtime bug (memory feedback_states_runtime_uncatchable, 2026-05-17). Fix pattern is already proven on the Market branch."
references:
  - apps/e2e-feature-tests/src/advisory/operating-mode-recommendation-shape.e2e.test.ts
  - services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts
out_of_scope:
  - "AgentCore Memory namespace mismatch (filed separately in parking)"
  - "updateOperatingMode mutation re-derivation gap (separate)"
  - "Refactoring AssemblePacket / advisory-bff transform topology — only fix the direct cause"
  - "Test-side polling refactors (test-infrastructure-polling-audit covers this)"
spec: null
plan: null
topic_memory:
  - project_agent_runtime_structured_output.md
  - project_e2e_feature_tests.md
validation_gate: null
---

# operating-mode-recommendation-shape e2e — empty proposedTrades (regression 2026-05-18)

## Today's evidence

Run on 2026-05-18 against deployed dev. Three phases, fresh tenant per phase:

- **CONSERVATIVE** GREEN — `count=5 equityWeight=0.20 largestPositionWeight=0.10`
- **BALANCED** RED — `No DecisionPacket with non-empty proposedTrades materialized for tenantId=e2e-1779132028404-70c14b89 within 360000ms`
- **AGGRESSIVE** RED — `No DecisionPacket with non-empty proposedTrades materialized for tenantId=e2e-1779132429884-b038b109 within 360000ms`

CloudWatch / Step Functions evidence for the two RED phases:

| Phase | Trigger | SF execution | Status | Failed at | Cause |
|---|---|---|---|---|---|
| BALANCED | MANDATE_SNAPSHOT_CREATED | `73749bbc-4b18-7f58-bb84-f97d107d7997_b5c142ee-...` | FAILED in 155 ms | `LookupInvestorProfileSnapshot` (entered #10) | `States.Runtime: JSONPath '$.Item.agentOutput.M' could not be found in the input` |
| AGGRESSIVE | MANDATE_SNAPSHOT_CREATED | `acba08b6-4ffa-2bef-da69-ab697e613882_c86facad-...` | FAILED in 232 ms | `LookupInvestorProfileSnapshot` (entered #10) | `States.Runtime: JSONPath '$.Item.agentOutput.M' could not be found in the input` |

The DDB `GetItem` response carried `Content-Length: 2` — i.e. the response is `{}` with no `Item` key — so the `ResultSelector` extraction of `$.Item.agentOutput.M` fails synchronously and the execution aborts before any agent runs. No DecisionPacket is ever produced, so the test's polling never resolves.

## Root cause

`services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts:331-352`:

```ts
const lookupInvestorProfileSnapshot = new sfn.CustomState(this, 'LookupInvestorProfileSnapshot', {
  stateJson: {
    Type: 'Task',
    Resource: 'arn:aws:states:::dynamodb:getItem',
    Parameters: { TableName: props.tableName, Key: { pk: {...}, sk: { S: 'InvestorProfileSnapshot' } } },
    ResultSelector: { 'agentOutput.$': '$.Item.agentOutput.M' },
    ResultPath: '$.agentResults.InvokeInvestorProfile',
  },
});
```

This state is reached on the "no profile carried in trigger" branch of `ResolveInvestorProfile`. The DDB row it queries (`InvestorProfileSnapshot#<tenant>#<user>`) is CDC-projected from `INVESTOR_PROFILE_UPDATED` via `SnapshotProjectorIngress`. On a brand-new tenant, that projection races with the `MANDATE_SNAPSHOT_CREATED` projection that triggers the SF — when the mandate projection wins, the SF runs before the profile snapshot exists, the `ResultSelector` cannot find `.Item.agentOutput.M`, and the engine raises `States.Runtime`.

Per `feedback_states_runtime_uncatchable.md` (2026-05-17), `States.Runtime` is not catchable by `Retry`/`Catch` — the SF dies immediately. The required pattern is `Choice` on `isPresent($.Item)` before any `ResultSelector` reaches into the response.

## Why the Market branch does not have this problem

`services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts:395-425` already implements the correct pattern for `LookupMarketSnapshot`: a `DynamoGetItem` writing to `$.marketSnapshotResponse`, followed by a `Choice` (`CheckMarketSnapshotPresent`) that branches between `ExtractMarketSnapshot` (Pass, lifts `Item.agentOutput.M`) on hit and `HandleMissingMarketSnapshot` (Pass, seeds `{ agentOutput: {} }`) on miss. PE + AN already tolerate empty `agentResults.InvokeInvestorProfile.agentOutput` via `?? {}` in their event-listeners, so the same `handleMissing` Pass works for the investor branch.

## Why CONSERVATIVE passed and BALANCED+AGGRESSIVE failed

Pure timing variance. `--runInBand` runs the phases sequentially; each fires its own `INVESTOR_PROFILE_UPDATED` then `MANDATE_ISSUED` for a fresh tenant. Whichever CDC projection settles first wins. In the 2026-05-18 run, CONSERVATIVE was lucky; BALANCED + AGGRESSIVE were not. Bedrock throttling is not implicated — the SF never reaches any agent invocation.

## Cheapest fix (mirror the Market branch)

In `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts`:

1. Convert `lookupInvestorProfileSnapshot` from `CustomState` with `ResultSelector` to `sfnTasks.DynamoGetItem` with `resultPath: '$.investorProfileSnapshotResponse'` (no `ResultSelector`).
2. Add `extractInvestorProfileSnapshot` (Pass, lifts `$.investorProfileSnapshotResponse.Item.agentOutput.M`) and `handleMissingInvestorProfileSnapshot` (Pass, seeds `{ agentOutput: {} }`) — symmetric to Market.
3. Insert a `CheckInvestorProfileSnapshotPresent` Choice between the lookup and the `MergeProjections` Pass, branching on `isPresent('$.investorProfileSnapshotResponse.Item')`.

This is a CDK-only change; no agent-runtime, BFF, or fixture work needed.

## Cross-reference

The same SF race blocks `scenario-12-rebalance-on-drift-missing-mandate-fixture` (rank 11) inside its `withLiveDecision()` prep cycle. One fix resolves both items.
