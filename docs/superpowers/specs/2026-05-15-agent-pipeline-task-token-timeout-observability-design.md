# Spec: agent-pipeline TaskTimedOut observability

Date: 2026-05-15
Status: queued (rank 1)
Backlog file: [`docs/backlog/agent-pipeline-task-token-timeout-observability.md`](../../backlog/agent-pipeline-task-token-timeout-observability.md)

## Problem

`apps/e2e-feature-tests` scenarios 11 (`first-decision`) and 12 (`rebalance-on-drift`) fail 100% of the time on the deployed dev environment (2026-05-15 run). Both time out waiting for `getDecisionHistory` to return any item.

Root-cause investigation (this session, evidence captured below) traced the failure to a silent `INFO`-level log in `libs/event-processor/src/pipelines/resume-state-machine.ts:47–61`. The pipeline collapses three distinct SFN errors into one swallow branch:

```ts
if (sfnError.name === 'TaskTimedOut' ||
    sfnError.name === 'InvalidToken' ||
    sfnError.name === 'TaskDoesNotExist') {
  logger.info('SF task already resolved, treating duplicate as success', { … });
}
```

This is correct for `TaskDoesNotExist` (a genuine duplicate where another invocation already resolved the token). It is **wrong** to treat `TaskTimedOut` and `InvalidToken` as benign — those are real system failures that the swallow path silently hides.

### Evidence (from 2026-05-15 e2e run, dev account 771924376645)

SF `dev-decision-workflow-ctrl-decisionstatemachine` execution history (every execution in the test window, 20 sampled):

```
#5  TaskSucceeded   resource=dynamodb:getItem      LookupMandateSnapshot ok
#14 TaskScheduled   resource=events:putEvents.waitForTaskToken  InvokeInvestorProfile
#16 TaskScheduled   resource=events:putEvents.waitForTaskToken  InvokeMarketIntelligence
#19 TaskSubmitted   InvokeInvestorProfile
#20 TaskSubmitted   InvokeMarketIntelligence
#21 TaskTimedOut    InvokeInvestorProfile           error=States.Timeout
#22 TaskTimedOut    InvokeMarketIntelligence        error=States.Timeout
#25 ExecutionFailed error=States.Timeout
```

Lambda log breakdown (`"already resolved"` events, last 30 min):

| Lambda | `"already resolved"` events | `sfnErrorName` breakdown |
|---|---|---|
| `dev-investor-profile-ctrl-IngressHandler` | 40 | `TaskTimedOut: 40` |
| `dev-market-intelligence-ctr-IngressHandler` | 40 | `TaskTimedOut: 40` |
| `dev-portfolio-engine-ctrl-IngressHandler`  |  1 | `TaskTimedOut: 1` |

SQS state at investigation time:

| Queue | Visible | Inflight | Visibility TO |
|---|---|---|---|
| `dev-investor-profile-ctrl-IngressQueue` | 0 | **414** | 1800s |
| `dev-market-intelligence-ctrl-IngressQueue` | **386** | 5 | 1800s |
| `dev-portfolio-engine-ctrl-IngressQueue` | 0 | 0 | 1800s |

Lambda `ESM.maxConcurrency=5`, `batchSize=1`. Each invocation invokes AgentCore (~5–30s). Effective drain ≤ 0.33 msg/s. SF task `TimeoutSeconds=600`. The system enters a state where messages arrive at the Lambda well after their corresponding SF task token has already timed out — and the swallow path masks 100% of those failures as `INFO`-level "duplicate" logs.

The user observation ("worse than after last fixes") is consistent with Phase A/B (2026-05-14) increasing per-invocation work (long-term Memory writes, larger SF state payloads), pushing the pipeline past its drain capacity.

## Goal

Make `TaskTimedOut` and `InvalidToken` failures observable. Do NOT change control flow yet — that is the scope of the architectural follow-up workstream.

## Non-goals (out of scope)

- Queue purge or one-shot remediation of the current backlog.
- Visibility-timeout / Lambda concurrency / SF `TimeoutSeconds` tuning.
- Moving agent invocation off the SQS→Lambda→AgentCore hop.
- Reducing Phase A/B Memory-write latency.
- Bubbling the error up (changing `skip()` to a retry) — this might worsen the backlog. Behaviour change requires evidence from the new logs first.

Each of the above is filed as a separate backlog entry; see `agent-pipeline-backlog-trap-architectural`.

## Design

### File modified

`libs/event-processor/src/pipelines/resume-state-machine.ts` — single file, ~15-line diff.

### Change

Split the existing `if (TaskTimedOut || InvalidToken || TaskDoesNotExist)` branch into two:

```ts
} catch (sfnError: unknown) {
  if (!(sfnError instanceof Error)) throw sfnError;

  if (sfnError.name === 'TaskDoesNotExist') {
    logger.info('SF task already resolved (genuine duplicate)', {
      eventType: ctx.eventType,
      eventId: ctx.eventId,
    });
  } else if (sfnError.name === 'TaskTimedOut' || sfnError.name === 'InvalidToken') {
    const processingLagMs = ctx.timestamp ? Date.now() - new Date(ctx.timestamp).getTime() : null;
    logger.error('SF task token unresolvable — agent-pipeline backlog or token regression', {
      eventType: ctx.eventType,
      eventId: ctx.eventId,
      sfnErrorName: sfnError.name,
      taskTokenPrefix: taskToken.slice(0, 20),
      eventCreatedAt: ctx.timestamp,
      processingLagMs,
    });
  } else {
    throw sfnError;
  }
}
```

### Why this and not more

1. The control-flow remains identical — pipeline still returns `skip()` so SQS does not requeue into the same dead token. We do not yet know whether bubbling the failure up would help or just amplify the backlog. The new ERROR logs will tell us.
2. `processingLagMs` is the single most informative new field: it directly answers "how stale is this event by the time we touched it?" In the current run, it would print values in the 5–10 min range, immediately confirming the backlog-trap hypothesis.
3. `taskTokenPrefix` (20 chars) is enough to correlate Lambda log → SF execution without leaking the full token.

## Validation gate

1. Land + deploy `event-processor` consumers (4 agent ctrls + advisory-bff + decision-workflow-ctrl).
2. Re-run `apps/e2e-feature-tests` scenarios **11 + 12 only** with `NESTFOLIO_INTEG_PREFIX=dev`.
3. Scenarios are expected to still **fail** (this is observability, not a fix).
4. **Pass criterion**: CloudWatch Logs Insights query

   ```
   fields @timestamp, eventType, sfnErrorName, processingLagMs
   | filter level = "ERROR" and message like /agent-pipeline backlog/
   | stats count() by sfnErrorName
   ```

   returns ≥ 1 ERROR per failed test, with `processingLagMs >> 600000` for the `TaskTimedOut` lines, confirming the backlog-trap hypothesis.

## Tests

`libs/event-processor/test/pipelines/resume-state-machine.test.ts`:

- Existing test `'treats SendTaskSuccess TaskTimedOut as success (duplicate event)'` → rename to `'logs ERROR + processingLagMs when SendTaskSuccess returns TaskTimedOut'`, retain behaviour assertion (no batch failure), add assertion `expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('backlog or token regression'), expect.objectContaining({ sfnErrorName: 'TaskTimedOut', processingLagMs: expect.any(Number) }))`.
- Existing test for `InvalidToken` → analogous rename + ERROR assertion.
- Existing test for `TaskDoesNotExist` → assert `logger.info` was called with the "genuine duplicate" message, NOT `logger.error`.

## Risks

- Log volume increase: each backlogged event now produces an ERROR log line. With 414+386 inflight messages, the first post-deploy minutes could produce ~800 ERROR lines. Acceptable — this is the signal we are trying to create.
- No alarm wired yet. Out of scope; CloudWatch alarm wiring is part of the architectural follow-up.

## Open questions

None for this scope.
