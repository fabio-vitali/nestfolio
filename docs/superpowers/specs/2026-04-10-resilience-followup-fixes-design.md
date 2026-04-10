# Resilience Follow-up Fixes — Design Spec

**Date:** 2026-04-10
**Status:** Approved
**Author:** Brainstorming session with Fabio
**Predecessor:** `docs/superpowers/specs/2026-04-10-resilience-integration-tests-design.md`

## Background

The resilience integration tests shipped on 2026-04-10 (commits `22f2a3a..2af1997`, merged via fast-forward) added 16 integration tests across 6 financial-critical services. The implementation work surfaced three architectural findings that the tests worked around rather than fixed:

1. **portfolio-engine-ctrl has no idempotency for AgentInvocation rows.** `agent-service.runPipeline()` writes IN_PROGRESS and COMPLETED rows via direct `PutCommand` with a fresh `randomUUID()` invocationId, completely independent of `ctx.eventId`. Duplicate `CONSTRUCT_PORTFOLIO` events trigger Bedrock twice and create distinct invocation rows. The integration test was relaxed to a bounded `[n, n+1]` check.
2. **EventBusTrap exhibits SQS at-least-once re-receive.** `waitForEvent` doesn't delete consumed SQS messages, so visibility timeout expiry causes them to re-appear in subsequent `drain()` calls. The ledger-ctrl CDC test hit this in the parallel validation run; commit `2af1997` shipped a per-test workaround that filters re-receives by `detail.id`.
3. **ledger-ctrl reducer `version` field is non-deterministic under batching.** The reducer increments `version` per *invocation*, not per *event*, so two runs that process the same N events into the same final state can land on different versions. Commit `9365b67` added `'version'` to `DYNAMIC_FIELDS` so `stripDynamicFields` removes it during snapshot comparison.

The investigation also surfaced a fourth issue (1B) layered on top of finding #1: even with idempotent invocation tracking, `resumeStateMachine.ts:41` always sends `SendTaskSuccessCommand`, which fails on the duplicate's invocation because the original already resolved the SF task. The Lambda errors → SQS retries → eventually DLQ. This affects every service using `resumeStateMachine`, not just portfolio-engine-ctrl.

This spec defines the architectural fix for all four issues so the workarounds can be reverted.

## Goals

- Make `agent-service.runPipeline()` idempotent: duplicate events skip Bedrock entirely and produce exactly one IN_PROGRESS+COMPLETED pair per `eventId`
- Make `resumeStateMachine` tolerate "task already resolved" errors from SF, so duplicate handler invocations don't trigger SQS retries / DLQ
- Make `EventBusTrap` consume each unique SQS message exactly once across the trap's lifetime, regardless of visibility timeout behavior
- Drop the vestigial `version` field from ledger-ctrl snapshots and derived rows; use `lastEventSequence` as the sk discriminator for events
- Tighten the integration tests to assert exact counts (no `[n, n+1]` relaxation, no `detail.id` filter, no `version` in `DYNAMIC_FIELDS`)
- Pass all 16 resilience tests in parallel with **zero retries** on the final validation run

## Non-Goals

- Adding "exactly-once" semantics to event-processor at the framework level (e.g., processed-events outbox table). The fixes here are surgical; the framework primitive can come later.
- Refactoring the agent pipeline to remove the IN_PROGRESS row entirely. The two-write IN_PROGRESS→COMPLETED pattern stays — it's useful for observability dashboards that want to show "this decision is currently being processed".
- Changing the ledger-ctrl event-sourcing semantics. Removing `version` is a metadata cleanup, not a model change.
- Switching ingress to FIFO SQS queues with content-based dedup. Out of scope.

## Architecture

Four independent fixes in three layers, plus one cross-cutting framework hardening:

| # | Layer | File | Change |
|---|-------|------|--------|
| 1A | service handler | `services/advisory/portfolio-engine-ctrl/src/agent-service.ts` | Idempotent invocation tracking via deterministic sk + conditional write |
| 1A | service handler | `services/advisory/portfolio-engine-ctrl/src/handlers/event-listener.ts` | Pass `ctx.eventId`, catch `DuplicateInvocationError` |
| 1B | shared library | `libs/event-processor/src/pipelines/resume-state-machine.ts` | Tolerate `TaskTimedOut` / `InvalidToken` / `TaskDoesNotExist` from SF |
| 2 | test fixture | `libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts` | Auto-delete on receive + in-memory `MessageId` dedup |
| 3 | service handler | `services/ledger/ledger-ctrl/src/handlers/reducer.ts` | Drop `currentVersion` and version increment |
| 3 | service handler | `services/ledger/ledger-ctrl/src/repositories/ledger.repository.ts` | Drop `version` field; use `lastEventSequence` as sk discriminator |

Sections 1A and 1B are coupled (must ship together). Sections 2 and 3 are independent and can ship in any order.

## Section 1A: portfolio-engine-ctrl AgentInvocation Idempotency

### Current state

`agent-service.ts:27`:
```typescript
const invocationId = randomUUID();
// ...
await deps.docClient.send(new PutCommand({
  TableName: deps.tableName,
  Item: { pk: `DECISION#${decisionId}`, sk: `INV#${invocationId}`, status: 'IN_PROGRESS', ... },
}));
```

The `invocationId` is generated fresh per call, so duplicate invocations produce distinct sks and distinct rows. There is no conditional check.

The handler at `event-listener.ts:47` already returns `record('AgentInvocation', { decisionId, tenantId, agentName: 'portfolio-engine' })`. The framework executes this with `pk: T#${tenantId}` / `sk: AgentInvocation#${ctx.eventId}` and `attribute_not_exists(pk)`, so this row IS correctly deduplicated. The duplicate problem is exclusively in the per-decision tracking rows written directly by `agent-service.ts`.

### Target state

- `runPipeline()` signature changes from `runPipeline(event)` to `runPipeline(eventId, event)`
- The sk becomes `INV#${eventId}` (deterministic)
- The first write (IN_PROGRESS) uses `ConditionExpression: 'attribute_not_exists(sk)'` to acquire the lock
- The IN_PROGRESS row carries `ttl: Math.floor(Date.now() / 1000) + 3600` (1 hour expiry) so orphaned locks self-recover after 1 hour
- On `ConditionalCheckFailedException`, the function throws a new exported error class `DuplicateInvocationError extends Error` carrying the `eventId`
- The COMPLETED write (line 56-70) stays unconditional — it overwrites IN_PROGRESS at the same sk, marking the lock as complete and dropping the `ttl` field (so completed records persist)
- `event-listener.ts` catches `DuplicateInvocationError` from `runPipeline` and returns `{ output: { decisionId, tenantId, deduplicated: true } }` without any intents

### Code sketch

```typescript
// agent-service.ts
export class DuplicateInvocationError extends Error {
  readonly eventId: string;
  constructor(eventId: string) {
    super(`Duplicate agent invocation for eventId ${eventId}`);
    this.name = 'DuplicateInvocationError';
    this.eventId = eventId;
  }
}

export const createAgentService = (deps: AgentServiceDeps) => {
  const orchestrator = createOrchestrator({ /* ... */ });

  return {
    runPipeline: async (eventId: string, event: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const startedAt = new Date().toISOString();
      const subject = (event.subject ?? event) as Record<string, unknown>;
      const decisionId = subject.decisionId as string;
      const tenantId = subject.tenantId as string;
      const sk = `INV#${eventId}`;
      const ttl = Math.floor(Date.now() / 1000) + 3600;

      // Acquire lock
      try {
        await deps.docClient.send(new PutCommand({
          TableName: deps.tableName,
          Item: {
            pk: `DECISION#${decisionId}`,
            sk,
            __typename: 'AgentInvocation',
            invocationId: eventId,
            decisionId,
            tenantId,
            status: 'IN_PROGRESS',
            startedAt,
            ttl,
          },
          ConditionExpression: 'attribute_not_exists(sk)',
        }));
      } catch (error: unknown) {
        if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
          throw new DuplicateInvocationError(eventId);
        }
        throw error;
      }

      // Run Bedrock
      const result = await invokeOrchestrator(orchestrator, {
        tenantId,
        decisionId,
        upstreamOutputs: subject.context ?? subject.upstreamOutputs ?? {},
      });

      const completedAt = new Date().toISOString();
      const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

      // Mark complete (overwrites IN_PROGRESS, drops ttl)
      await deps.docClient.send(new PutCommand({
        TableName: deps.tableName,
        Item: {
          pk: `DECISION#${decisionId}`,
          sk,
          __typename: 'AgentInvocation',
          invocationId: eventId,
          decisionId,
          tenantId,
          status: 'COMPLETED',
          startedAt,
          completedAt,
          durationMs,
        },
      }));

      return {
        decisionId,
        allocations: (result as Record<string, unknown>)['portfolio-construction'] ?? {},
        trades: (result as Record<string, unknown>)['rebalance-planner'] ?? {},
        metadata: { durationMs, modelTiers: ['opus', 'sonnet'] },
      };
    },
  };
};
```

```typescript
// event-listener.ts (CONSTRUCT_PORTFOLIO handler)
CONSTRUCT_PORTFOLIO: async (payload: EventPayload, ctx: EventContext) => {
  const subject = payload.subject ?? {};
  const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
  const decisionId = subject.decisionId as string;

  logger.info('Processing CONSTRUCT_PORTFOLIO', { decisionId, tenantId });

  const session = deps.memoryClient.openDecisionSession(tenantId, decisionId);

  const [investorRecords, marketRecords, pastRationale] = await Promise.all([
    session.readUpstreamOutput('investor-profile'),
    session.readUpstreamOutput('market-intelligence'),
    session.searchLongTermMemory('allocation rationale decisions'),
  ]);

  let result: Record<string, unknown>;
  try {
    result = await deps.agentService.runPipeline(ctx.eventId, {
      tenantId,
      decisionId,
      investorProfile: investorRecords[0]?.content ? JSON.parse(investorRecords[0].content) : {},
      marketAnalysis: marketRecords[0]?.content ? JSON.parse(marketRecords[0].content) : {},
      pastRationale: pastRationale.map(r => r.content),
    });
  } catch (error) {
    if (error instanceof DuplicateInvocationError) {
      logger.info('Duplicate CONSTRUCT_PORTFOLIO event, skipping', { eventId: ctx.eventId, decisionId });
      return { output: { decisionId, tenantId, deduplicated: true } };
    }
    throw error;
  }

  await session.writeAgentOutput(result);

  return {
    output: { decisionId, tenantId },
    intents: [record('AgentInvocation', { decisionId, tenantId, agentName: 'portfolio-engine' })],
  };
},
```

### Edge cases

- **Orphaned IN_PROGRESS row (Lambda crashes mid-Bedrock):** The TTL (1 hour) auto-expires the lock. The next retry can re-acquire the lock and re-run. Bedrock crashes typically happen quickly (validation errors, throttling), so the orphan window is bounded — slow user-visible impact, no data loss.
- **Duplicate after completion:** The COMPLETED row already exists at `INV#${eventId}` with no TTL. The duplicate's `attribute_not_exists(sk)` check fails immediately, throws `DuplicateInvocationError`, handler returns deduplicated. No Bedrock cost.
- **Concurrent duplicates (two Lambdas processing same event simultaneously):** The conditional write is atomic at DDB. Exactly one wins; the loser throws and skips. No TOCTOU window.

## Section 1B: `resumeStateMachine` Tolerates Already-Resolved Tasks

### Current state

`resume-state-machine.ts:41-44`:
```typescript
await sfnClient.send(new SendTaskSuccessCommand({
  taskToken,
  output: JSON.stringify(result.output),
}));
```

This call throws on `TaskTimedOut`, `InvalidToken`, or `TaskDoesNotExist` if the SF task has already been resolved by a prior duplicate. The error is caught at line 49, the framework attempts `SendTaskFailureCommand` (which also fails for the same reason), then re-throws. Lambda errors → SQS retries (default 3) → DLQ.

### Target state

Wrap the `SendTaskSuccessCommand` call in its own try/catch. On the three "task already resolved" error names, log info and return normally as if the callback succeeded. Other errors continue to propagate to the existing outer catch.

### Code sketch

```typescript
// resume-state-machine.ts inside the wrappedHandlers loop
try {
  const result = await resumeHandler(payload, ctx);
  const intents = result.intents ?? [];

  try {
    await sfnClient.send(new SendTaskSuccessCommand({
      taskToken,
      output: JSON.stringify(result.output),
    }));
    logger.info('State machine resumed', { eventType: ctx.eventType, taskToken: taskToken.slice(0, 20) });
  } catch (sfnError: unknown) {
    if (sfnError instanceof Error && (sfnError.name === 'TaskTimedOut' || sfnError.name === 'InvalidToken' || sfnError.name === 'TaskDoesNotExist')) {
      logger.info('SF task already resolved, treating duplicate as success', {
        eventType: ctx.eventType,
        eventId: ctx.eventId,
        sfnErrorName: sfnError.name,
      });
    } else {
      throw sfnError;
    }
  }

  return intents.length > 0 ? intents : skip();
} catch (error) {
  // existing error handling unchanged
}
```

### Why this is in scope

Without 1B, Section 1A only solves half of finding #1. The duplicate handler invocation still errors at the framework layer even after agent-service correctly deduplicates. Sections 1A and 1B must ship together.

Other services using `resumeStateMachine` (decision-workflow-ctrl orchestrators, advisory-ctrl, etc.) get the benefit automatically without code changes. The semantic justification: SF task tokens are at-most-once by design — if the task is already resolved, the duplicate has nothing useful to add.

## Section 2: EventBusTrap Auto-Delete + In-Memory Dedup

### Current state

`event-bus-trap.fixture.ts` consumes messages from the trap's per-test SQS queue via `ReceiveMessageCommand` and pushes them to an in-memory `captured: CapturedEvent[]` array. It never calls `DeleteMessageBatchCommand`, so messages remain in the queue. SQS visibility timeout defaults to 30s (or whatever the queue is configured with). When that expires, unconsumed messages become visible again and the next `ReceiveMessageCommand` returns them — including messages already returned by a prior `waitForEvent`.

Symptoms in the parallel validation run: ledger-ctrl CDC test asserted no duplicate `BALANCE_UPDATED` events after publishing a duplicate, but `drain()` returned the same `BalanceEvent` already consumed by `waitForEvent`. The shipped workaround in commit `2af1997` filters re-receives by `detail.id` in the test itself.

### Target state

Two layers of defense:

1. **Auto-delete on receive:** After every `ReceiveMessageCommand` returns messages, immediately call `DeleteMessageBatchCommand` with the receipt handles (best-effort — delete failures log a warning and continue).
2. **In-memory MessageId dedup:** Maintain `private readonly seenMessageIds = new Set<string>()`. On every received message, if its SQS `MessageId` is in the set, skip it. Otherwise add to the set, push to `captured`, return.

The combination is robust: deletes prevent re-receives in the common case; the Set catches rare cases where delete failed or the visibility timeout expired before the delete reached SQS.

### Code sketch

```typescript
// event-bus-trap.fixture.ts (additions)
import { DeleteMessageBatchCommand } from '@aws-sdk/client-sqs';

export class EventBusTrap {
  // existing fields...
  private readonly seenMessageIds = new Set<string>();

  // inside the SQS receive loop (used by waitForEvent and drain):
  private async receiveAndCapture(): Promise<CapturedEvent[]> {
    const result = await this.sqs.send(new ReceiveMessageCommand({
      QueueUrl: this.queueUrl!,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 1,
    }));

    const messages = result.Messages ?? [];
    if (messages.length === 0) return [];

    // Best-effort delete to free SQS storage and reduce visibility-timeout re-receives
    try {
      await this.sqs.send(new DeleteMessageBatchCommand({
        QueueUrl: this.queueUrl!,
        Entries: messages
          .filter(m => m.MessageId && m.ReceiptHandle)
          .map(m => ({ Id: m.MessageId!, ReceiptHandle: m.ReceiptHandle! })),
      }));
    } catch (error) {
      logger.warn('EventBusTrap: DeleteMessageBatch failed (best-effort, continuing)', { error });
    }

    const fresh: CapturedEvent[] = [];
    for (const msg of messages) {
      if (!msg.MessageId || this.seenMessageIds.has(msg.MessageId)) continue;
      this.seenMessageIds.add(msg.MessageId);
      const event = JSON.parse(msg.Body!) as CapturedEvent;
      this.captured.push(event);
      fresh.push(event);
    }
    return fresh;
  }
}
```

The exact integration into `waitForEvent` and `drain` follows the existing structure of the file — both methods call into the receive-and-capture path. The logic stays the same; only the inner receive function changes.

### Test reverts enabled by Section 2

`services/ledger/ledger-ctrl/test/integration/ledger-ctrl.resilience.integration.test.ts` — revert the `firstEmissionId` capture and `detail.id` filter from commit `2af1997`. Restore `expect(balanceEvents).toHaveLength(0)` as the assertion. Drop the explanatory comment about SQS at-least-once. Keep the timeout bumps (`waitForEvent` 120s, test 360s) — those are independently useful.

## Section 3: Drop `version` from ledger-ctrl

### Current state

`reducer.ts:74,82`:
```typescript
const currentVersion = (existing?.['version'] as number) ?? 0;
// ...
await repository.saveSnapshotWithEvents({
  // ...
  version: currentVersion + 1,
  // ...
});
```

`version` is incremented per *reducer invocation*. Two runs with the same N events processed in different batch counts produce different versions for the same final state. The field is written to AccountSnapshot, BalanceEvent, PortfolioEvent, LedgerEntryEvent, and SnapshotHistory rows, and is part of the sk for the three event types: `${typename}#${now}#${data.version}`.

Investigation confirmed (full grep across `services/`, `apps/`, `libs/`, `**/*.graphql`):
- No service consumes the `version` field from any AccountSnapshot/BalanceEvent/PortfolioEvent/LedgerEntryEvent/SnapshotHistory row
- The two `version: Int!` fields in `services/investor/investor-bff/src/schema.graphql:95` (`Mandate.version`) and `services/advisory/advisory-bff/src/schema.graphql:67` (`DecisionPacket.version`) are on completely unrelated entities in different services
- `apps/advisory-mfe/src/app/decision/audit-footer.component.ts:25` displays `v{{ version() }}` from `DecisionPacket`, not from any ledger snapshot
- `getLatestSnapshot()` is called only by ledger-ctrl's own reducer; ledger-bff doesn't query snapshots

The field has no consumers and provides no observable value.

### Target state

- Remove `version` entirely from the reducer logic, the repository writes, and the data type
- Replace the sk discriminator with `lastEventSequence`: `${typename}#${now}#${data.lastEventSequence}`
- Update unit tests
- Revert the workarounds shipped in commits `9365b67` (added `'version'` to `DYNAMIC_FIELDS`) and the corresponding test input

### Files touched

| File | Change |
|------|--------|
| `services/ledger/ledger-ctrl/src/handlers/reducer.ts` | Drop `currentVersion` (line 45), drop both `version: currentVersion + 1` references (lines 74, 82) |
| `services/ledger/ledger-ctrl/src/repositories/ledger.repository.ts` | Remove `version: number` from data type (line 40); remove `version: data.version` from 4 Item bodies (166, 187, 209, 228); change 3 sk patterns to `${typename}#${now}#${data.lastEventSequence}` (lines 180, 201, 222) |
| `services/ledger/ledger-ctrl/test/handlers/reducer.test.ts` | Update assertions: drop `version` from expected save args |
| `services/ledger/ledger-ctrl/test/repositories/ledger.repository.test.ts` | Update sk assertions to expect `lastEventSequence` discriminator; drop `version` from expected DDB items |
| `libs/integration-testing/src/fixtures/account-seeding.fixture.ts:57` | Remove `version: 1` from seed item |
| `libs/integration-testing/src/resilience.ts:7` | Revert `'version'` from `DYNAMIC_FIELDS` (13 fields → 12 fields; `snapshotAt` stays) |
| `libs/integration-testing/test/resilience.test.ts:21` | Revert: drop `version: 3` from test input; restore description without `version` |

### Sk collision risk

The new sk format is `BalanceEvent#${now}#${lastEventSequence}`. Two reducer invocations within the same millisecond would have to process events with the same `lastEventSequence` — impossible because events are sequenced monotonically per tenant/streamType, and `repository.queryEntriesSince(lastSeq)` guarantees the new `lastEventSequence` is strictly greater than the previous. No collision possible.

## Section 4: Test reverts and tightening

After all four section fixes are implemented, the following test workarounds become unnecessary:

| Workaround commit | File | Revert |
|-------------------|------|--------|
| `9365b67` | `libs/integration-testing/src/resilience.ts` | Remove `'version'` from `DYNAMIC_FIELDS` |
| `9365b67` | `libs/integration-testing/test/resilience.test.ts` | Remove `version: 3` from input + restore description |
| `2af1997` | `services/ledger/ledger-ctrl/test/integration/ledger-ctrl.resilience.integration.test.ts` | Drop `firstEmissionId` capture + `detail.id` filter; restore simple `toHaveLength(0)`; drop the SQS at-least-once explanatory comment |
| (in plan A.2) | `services/advisory/portfolio-engine-ctrl/test/integration/portfolio-engine-ctrl.resilience.integration.test.ts` | Tighten the relaxed `[n, n+1]` assertion to `expect(itemsAfter.length).toBe(1)` |

The reconciliation-ctrl timeout bump from `9365b67` (180s → 300s, 360s → 600s) stays — that's an independent calibration for parallel-load latency, not a workaround for any of the four findings.

## Testing Strategy

### Unit tests (TDD per change)

- **`agent-service.test.ts`** (new tests): mock DDB client; verify (a) IN_PROGRESS write uses `INV#${eventId}` sk + `attribute_not_exists(sk)` + ttl, (b) `ConditionalCheckFailedException` → `DuplicateInvocationError`, (c) successful path writes COMPLETED row at the same sk
- **`event-listener.test.ts`** (portfolio-engine-ctrl): verify handler passes `ctx.eventId` to `runPipeline`, catches `DuplicateInvocationError` and returns `{ output: { ..., deduplicated: true } }` without intents
- **`resume-state-machine.test.ts`** (event-processor): mock SFN client; throw `TaskTimedOut`, `InvalidToken`, `TaskDoesNotExist` from `SendTaskSuccessCommand`; verify handler returns intents normally and does NOT call `SendTaskFailureCommand`. Verify other error names still propagate.
- **`event-bus-trap.test.ts`** (integration-testing, new file): mock SQS client; return same `MessageId` twice; verify only first surfaces in `waitForEvent` and `drain`. Verify `DeleteMessageBatchCommand` is called after each receive.
- **`reducer.test.ts`** + **`ledger.repository.test.ts`**: update existing assertions to drop `version` references. Add a test that verifies the new sk format uses `lastEventSequence`.
- **`resilience.test.ts`** (integration-testing): revert the `version: 3` test input + description.

### Integration tests (re-run after each fix)

- **`portfolio-engine-ctrl:test-integration --testPathPatterns=resilience`** — after Sections 1A + 1B, the relaxed `[n, n+1]` assertion becomes exactly `1`. Both tests should pass on first attempt.
- **`ledger-ctrl:test-integration --testPathPatterns=resilience`** — after Section 2 (trap fix), the `firstEmissionId` filter is reverted. After Section 3 (drop version), the snapshot diff in the full shuffle test should match without any `DYNAMIC_FIELDS` workaround. All 5 tests should pass on first attempt.
- **Full parallel validation:**
  ```bash
  pnpm nx run-many -t test-integration \
    --projects=ledger-ctrl,execution-ctrl,broker-ctrl,reconciliation-ctrl,broker-alpaca-adpt,portfolio-engine-ctrl \
    --parallel=2 -- --testPathPatterns=resilience
  ```
  **Acceptance criteria:** zero retries, all 16 tests green on first attempt.

### Order of execution

1. Sections 1A + 1B (coupled) — agent-service idempotency + resumeStateMachine tolerance
2. Section 2 — event-bus-trap auto-delete + in-memory dedup
3. Section 3 — drop ledger-ctrl `version`
4. Section 4 — test reverts (folded into the above sections, but listed for clarity)
5. Final parallel validation

Sections 1A+1B, 2, and 3 are independently shippable. They can be implemented as a single PR or three sequential PRs at the implementer's discretion.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Section 1A: orphaned IN_PROGRESS rows accumulate if Bedrock has a sustained outage | Low | TTL of 1 hour auto-expires locks. DLQ catches sustained failures. |
| Section 1B: `TaskDoesNotExist` is not actually a real SFN error name | Low | Will verify against `@aws-sdk/client-sfn` exception types in implementation; unit test confirms behavior. The other two (`TaskTimedOut`, `InvalidToken`) are documented. |
| Section 2: a test elsewhere actually relies on re-receive behavior | Very low | Full grep of integration test files confirmed the only consumer of trap re-receives was the workaround we're reverting. New unit tests catch regressions. |
| Section 3: an undiscovered consumer of the `version` field exists | Very low | Multi-pass grep across services/apps/libs/graphql/yaml schemas all confirmed zero consumers. CDC events still emit whatever DDB Stream produces; consumers that ignored the field continue to ignore its absence. |
| Section 1A: Bedrock partial-success races with the COMPLETED write | Very low | The COMPLETED write is unconditional (overwrites). If it fails, the IN_PROGRESS row stays with TTL — recovers via the orphan path. |

## Success Criteria

1. All four findings have architectural fixes (not workarounds)
2. The three workaround commits' substantive changes are reverted (`9365b67` resilience.ts entries, `2af1997` ledger-ctrl test filter, the `[n, n+1]` relaxation in portfolio-engine-ctrl test)
3. The reconciliation-ctrl timeout bumps from `9365b67` are preserved (independent calibration)
4. All existing unit tests pass
5. New unit tests added for each section's behavior
6. Final parallel integration test run: all 16 tests pass on first attempt with zero retries

## Open Questions

None. Design fully approved across all five sections during the brainstorming session on 2026-04-10.
