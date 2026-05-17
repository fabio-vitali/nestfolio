---
id: marketsnapshot-fault-tolerant-cycle
status: shipped
type: refactor
notes: "Tolerate absent MarketSnapshot in DWC SF and delete the bootstrap CustomResource that papered over it"
references:
  - docs/backlog/advisory-cycle-agent-precomputation-impl.md
  - docs/superpowers/specs/2026-05-17-advisory-cycle-agent-precomputation-design.md
  - services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts
  - services/advisory/market-intelligence-ctrl/src/service.stack.ts
  - services/advisory/portfolio-engine-ctrl/src/handlers/event-listener.ts
  - services/advisory/advisory-narrative-ctrl/src/handlers/event-listener.ts
out_of_scope:
  - "Staleness alarm — cycle-entry CloudWatch metric MarketSnapshotAgeSeconds = now - $.Item.slowComponentsAt with alarm at ~6h. Tracked separately; the right place to surface 'scheduler is broken' once absent is tolerable."
  - "InvestorProfileSnapshot fault-tolerance — SF already has payload-first ResolveInvestorProfile Choice (HoistInvestorProfileFromTrigger) that bypasses the lookup when the trigger carries the profile. Narrower edge case. Revisit if it becomes a real failure mode."
spec: null
plan: null
topic_memory: []
validation_gate: |
  Code: 4 commits on `worktree-marketsnapshot-fault-tolerant-cycle` —
    - f4d6b4c0 feat(advisory): tolerate absent MarketSnapshot + delete bootstrap CR
    - 5989eda6 docs(advisory): regen C4 + advisory-cycle flow post-bootstrap removal
    - efcdbac5 fix(advisory): use DynamoGetItem for LookupMarketSnapshot Catch  (intermediate — Catch later replaced)
    - ec6e7c20 fix(advisory): redesign LookupMarketSnapshot fault-tolerance with Choice on isPresent
  Design pivot: initial Catch-on-States.Runtime approach reached deploy but did not actually fire in dev — empirically validated via synthetic SF execution that ExecutionFailed with `States.Runtime: JSONPath '$.Item.agentOutput.M' could not be found`. AWS Step Functions docs confirm `States.Runtime` is not catchable. Final design captures the raw GetItem response on `$.marketSnapshotResponse` and routes via `CheckMarketSnapshotPresent` (Choice on `isPresent($.marketSnapshotResponse.Item)`).
  Tests: `pnpm nx test decision-workflow-ctrl` 88/88; `pnpm nx test market-intelligence-ctrl` 66/66; `pnpm nx affected -t test,lint --base=origin/main` 9 projects green.
  Deploy: dev account 771924376645 — dev-decision-workflow-ctrl UPDATE_COMPLETE at 22:54:47 (Choice-based redeploy); dev-market-intelligence-ctrl UPDATE_COMPLETE at 22:35 with no BootstrapSnapshot resources (`describe-stack-resources` returns []).
  Validation: synthetic SF execution `validation-choice-1779051336` against deleted MarketSnapshot row — HandleMissingMarketSnapshot entered at event id 20, ParallelStateSucceeded, cycle proceeded to MergeProjections + LookupMandateSnapshot.
  E2E: `apps/e2e-feature-tests/src/advisory/first-decision.e2e.test.ts` PASS in 170.26s on the Choice-based redeploy (rerun after the empirical-validation pivot).
---

# MarketSnapshot fault-tolerant cycle (delete bootstrap CR)

## Why now

Surfaced during post-ship review of `advisory-cycle-agent-precomputation-impl`. The current design treats `MarketSnapshot` as a hard precondition for the decision cycle:

- `LookupMarketSnapshot` (CustomState `dynamodb:getItem`, `decision-state-machine.ts`) reads `$.Item.agentOutput.M` via `ResultSelector`. If `$.Item` is absent, the path resolution fails and the SF aborts with `States.Runtime`.
- Task 14 (commit `e89cc680`) added a CFN `CustomResource` + `BootstrapSnapshotFn` + `Provider` to block stack `Create` until the row materialises (5-minute poll). That eliminates the "15-minute window after fresh deploy" race but **only that race** — it does nothing for scheduler-disabled / scheduler-broken / Bedrock-outage / MI-Lambda-permission-drift scenarios that produce the same "row absent or stale" state on a long-running stack.

At the agent layer, the precondition isn't even real: PE and AN both read `subject.marketAnalysis ?? {}` (see `portfolio-engine-ctrl/src/handlers/event-listener.ts` and `advisory-narrative-ctrl/src/handlers/event-listener.ts`). Neither agent's prompt asserts the shape — absent market context degrades the decision, not breaks it.

The bootstrap CR is solving the wrong problem one layer too deep. The right shape is "the SF treats `MarketSnapshot` as best-effort context."

## Two coordinated moves

### 1. Make `LookupMarketSnapshot` fault-tolerant

Edit `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts`. Wrap the CustomState in a `Catch` that maps a missing-Item / `States.Runtime` failure to an empty `agentOutput` and continues to `MergeProjections`:

```typescript
const lookupMarketSnapshot = new sfn.CustomState(this, 'LookupMarketSnapshot', {
  stateJson: {
    Type: 'Task',
    Resource: 'arn:aws:states:::dynamodb:getItem',
    Parameters: { /* unchanged */ },
    ResultSelector: { 'agentOutput.$': '$.Item.agentOutput.M' },
    ResultPath: '$.agentResults.InvokeMarketIntelligence',
    Catch: [{
      ErrorEquals: ['States.Runtime', 'States.TaskFailed'],
      ResultPath: '$.agentResults.InvokeMarketIntelligence',
      // Note: the catch path may need a Pass state to inject the empty
      // shape — verify ASL semantics. Alternative: add a HandleAbsent
      // Pass state in the Catch's Next: target.
    }],
  },
});
```

Verify the exact catch-then-default plumbing in ASL — there may need to be an intermediate `Pass` state that emits `{ agentOutput: {} }` because raw `Catch` only routes; it doesn't shape the failure into a default.

Update the CDK test in `decision-state-machine.test.ts` to assert the catch handler is present and routes to `MergeProjections` (or whatever Pass-with-empty-default is named).

### 2. Delete the bootstrap custom resource

Drop from `services/advisory/market-intelligence-ctrl/src/service.stack.ts`:
- The `BootstrapSnapshotFn` `NodejsFunction`.
- The `state.getTable().grantReadData(bootstrapSnapshotFn)` + `eventBus.grantPutEventsTo(bootstrapSnapshotFn)`.
- The `Provider` (`BootstrapSnapshotProvider`).
- The `CustomResource` (`BootstrapSnapshotResource`).
- Remove `bootstrapSnapshotFn` from `addObservability({ extraLambdas: [...] })`.

Delete the handler file `services/advisory/market-intelligence-ctrl/src/handlers/bootstrap-snapshot.ts`.

Drop the 3 bootstrap stack tests added in Task 14 (the ones asserting Lambda timeout ≥ 5 min, the `Provider`-fronted custom resource, and the IAM grants on the bootstrap Lambda's role).

Service card (`services/advisory/market-intelligence-ctrl/CLAUDE.md`) — remove the BootstrapSnapshotProvider section.

## Validation gate (when shipped)

- `pnpm nx affected -t test,lint` green.
- Synth + deploy MI-ctrl: stack reaches `UPDATE_COMPLETE` without the custom resource. On a fresh deploy (drop the MarketSnapshot row first), no stack rollback.
- Drop the `MarketSnapshot#us-east-1` row from MI-ctrl's table in dev, then run `apps/e2e-feature-tests/src/advisory/first-decision.e2e.test.ts` — must PASS. Decision will surface with empty `marketAnalysis` flowing into PE/AN; agent outputs degrade gracefully.

## Out of scope (defer to a separate item)

- **Staleness alarm.** Absent is now tolerable; silently stale is a different problem. The follow-on improvement is a cycle-entry CloudWatch metric `MarketSnapshotAgeSeconds = now - $.Item.slowComponentsAt` with an alarm at e.g. 6h. That's the right place to surface "scheduler is broken." Mentioned here so the next reader knows the dimension exists, but tracked separately.
- **InvestorProfileSnapshot fault-tolerance.** The SF already has a payload-first `ResolveInvestorProfile` Choice (`HoistInvestorProfileFromTrigger`) that bypasses the lookup when the trigger carries the profile. The hard-dependency edge case is narrower than for MarketSnapshot. Revisit if it becomes a real failure mode.
