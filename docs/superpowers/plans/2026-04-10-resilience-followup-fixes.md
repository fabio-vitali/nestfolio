# Resilience Follow-up Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace three workarounds shipped during the resilience integration tests work with architectural fixes, plus harden `resumeStateMachine` against duplicate-callback errors.

**Architecture:** Four independent fixes in three layers — drop the vestigial `version` field from ledger-ctrl, make `EventBusTrap` consume each SQS message exactly once, tolerate "task already resolved" errors in `resumeStateMachine`, and make portfolio-engine-ctrl's `agent-service` idempotent via deterministic sk + conditional write. Each fix removes one or more workarounds (commits `9365b67`, `2af1997`, and the `[n, n+1]` relaxation in Task 8 of the predecessor plan).

**Tech Stack:** TypeScript, Jest, AWS SDK v3 (`@aws-sdk/client-sfn`, `@aws-sdk/client-sqs`, `@aws-sdk/lib-dynamodb`), `aws-sdk-client-mock`, Nx, pnpm

**Spec:** `docs/superpowers/specs/2026-04-10-resilience-followup-fixes-design.md`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `services/ledger/ledger-ctrl/src/handlers/reducer.ts` | Drop `currentVersion` and version increment |
| Modify | `services/ledger/ledger-ctrl/src/repositories/ledger.repository.ts` | Drop `version` from data type and Items; use `lastEventSequence` as sk discriminator |
| Modify | `services/ledger/ledger-ctrl/test/handlers/reducer.test.ts` | Drop `version` assertions |
| Modify | `services/ledger/ledger-ctrl/test/repositories/ledger.repository.test.ts` | Update sk + Item assertions |
| Modify | `libs/integration-testing/src/fixtures/account-seeding.fixture.ts` | Drop `version: 1` from seed |
| Modify | `libs/integration-testing/src/resilience.ts` | Revert `'version'` from `DYNAMIC_FIELDS` |
| Modify | `libs/integration-testing/test/resilience.test.ts` | Revert `version: 3` from test input + description |
| Modify | `libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts` | Auto-delete on receive + in-memory `MessageId` dedup |
| Create | `libs/integration-testing/test/fixtures/event-bus-trap.test.ts` | Unit tests for the new dedup + delete behavior |
| Modify | `services/ledger/ledger-ctrl/test/integration/ledger-ctrl.resilience.integration.test.ts` | Revert `firstEmissionId`/`detail.id` filter |
| Modify | `libs/event-processor/src/pipelines/resume-state-machine.ts` | Tolerate `TaskTimedOut` / `InvalidToken` / `TaskDoesNotExist` from SF |
| Modify | `libs/event-processor/test/pipelines/resume-state-machine.test.ts` | New tests for the three already-resolved error names |
| Modify | `services/advisory/portfolio-engine-ctrl/src/agent-service.ts` | New `DuplicateInvocationError` + idempotent runPipeline with deterministic sk + conditional write + TTL |
| Modify | `services/advisory/portfolio-engine-ctrl/src/handlers/event-listener.ts` | Pass `ctx.eventId` to `runPipeline`, catch `DuplicateInvocationError` |
| Modify | `services/advisory/portfolio-engine-ctrl/test/agent-service.test.ts` | Update existing tests for new signature + new lock tests |
| Modify | `services/advisory/portfolio-engine-ctrl/test/event-listener.test.ts` | Update for new signature + duplicate handling |
| Modify | `services/advisory/portfolio-engine-ctrl/test/integration/portfolio-engine-ctrl.resilience.integration.test.ts` | Tighten relaxed `[n, n+1]` to exactly `1` |

---

### Task 1: Drop `version` from ledger-ctrl reducer + repository

**Context:** The `version` field in ledger-ctrl is incremented per reducer invocation, not per event, so two runs that process the same N events in different batch counts produce different versions for the same final state. Investigation confirmed no consumer reads it. Removing it makes the snapshot deterministic by construction. The sk discriminator for derived event rows (`BalanceEvent`, `PortfolioEvent`, `LedgerEntryEvent`) becomes `lastEventSequence` instead.

**Files:**
- Modify: `services/ledger/ledger-ctrl/src/handlers/reducer.ts:45,74,82`
- Modify: `services/ledger/ledger-ctrl/src/repositories/ledger.repository.ts:40,166,180,187,201,209,222,228`
- Modify: `services/ledger/ledger-ctrl/test/handlers/reducer.test.ts`
- Modify: `services/ledger/ledger-ctrl/test/repositories/ledger.repository.test.ts`

- [ ] **Step 1: Update the reducer to stop tracking version**

In `services/ledger/ledger-ctrl/src/handlers/reducer.ts`, remove the `currentVersion` variable (line 45) and the two `version: currentVersion + 1` references (lines 74, 82).

The current `processGroup` body (lines 28-87) becomes:

```typescript
processGroup: async (groupKey, records) => {
  const [tenantId, streamType] = groupKey.split('#');

  // Reconstruct RequestContext from the first stream record (fields written by event-listener)
  const firstRecord = records[0];
  const reqCtx: RequestContext = {
    tenantId: asTenantId(tenantId),
    userId: asUserId((firstRecord.userId as string) ?? 'system'),
    region: (firstRecord.region as string) ?? process.env['AWS_REGION'] ?? 'us-east-1',
  };

  // 1. Load current snapshot
  const existing = await repository.getLatestSnapshot(tenantId, streamType);
  const currentState: AccountState = existing
    ? parseAccountState(existing)
    : INITIAL_ACCOUNT_STATE;
  const lastSeq = currentState.lastEventSequence;

  // 2. Query events since last snapshot sequence
  const events = await repository.queryEntriesSince(tenantId, streamType, lastSeq);
  if (events.length === 0) {
    logger.info('No new events to reduce', { groupKey });
    return;
  }

  // 3. Reduce events
  const nextState = events.reduce(
    (state, event) => accountReducer(state, event as unknown as LedgerEntry),
    currentState,
  );

  const maxSeq = events.reduce(
    (max, e) => Math.max(max, (e['sequenceNo'] as number) ?? 0),
    0,
  );

  // 4. Determine what changed
  const balanceChanged = nextState.cashBalanceCents !== currentState.cashBalanceCents;
  const positionsChanged = JSON.stringify(nextState.positions) !== JSON.stringify(currentState.positions);

  // 5. Save snapshot + derived events (BalanceEvent, PortfolioEvent, LedgerEntryEvent)
  await repository.saveSnapshotWithEvents({
    streamType: streamType as 'actual' | 'simulated',
    state: nextState,
    lastEventSequence: maxSeq,
    balanceChanged,
    positionsChanged,
    ttlDays: SNAPSHOT_TTL_DAYS,
  }, reqCtx);

  logger.info('Snapshot updated with derived events', {
    groupKey,
    lastEventSequence: maxSeq,
    eventCount: events.length,
    balanceChanged,
    positionsChanged,
  });
},
```

The diff: drop the line `const currentVersion = (existing?.['version'] as number) ?? 0;`, drop the `version: currentVersion + 1,` line in the `saveSnapshotWithEvents` call, and replace `version: currentVersion + 1,` in the `logger.info` call (line 82) with `lastEventSequence: maxSeq,`.

- [ ] **Step 2: Update the repository data type and writes**

In `services/ledger/ledger-ctrl/src/repositories/ledger.repository.ts`, find the `saveSnapshotWithEvents` parameter type (around line 35-45) and remove the `version: number` field. The interface should look like (only the relevant part):

```typescript
async saveSnapshotWithEvents(data: {
  streamType: 'actual' | 'simulated';
  state: AccountState;
  lastEventSequence: number;
  balanceChanged: boolean;
  positionsChanged: boolean;
  ttlDays: number;
}, ctx: RequestContext): Promise<void>
```

Then remove `version: data.version,` from the AccountSnapshot Item (was line 166), the BalanceEvent Item (was line 187), the PortfolioEvent Item (was line 209), and the LedgerEntryEvent Item (was line 228).

Then change three `sk` patterns. Each becomes `${typename}#${now}#${data.lastEventSequence}` instead of `${typename}#${now}#${data.version}`:

```typescript
// BalanceEvent
sk: `BalanceEvent#${now}#${data.lastEventSequence}`,

// PortfolioEvent
sk: `PortfolioEvent#${now}#${data.lastEventSequence}`,

// LedgerEntryEvent
sk: `LedgerEntryEvent#${now}#${data.lastEventSequence}`,
```

The AccountCheckpoint write (around line 269) does NOT use version — leave it unchanged.

- [ ] **Step 3: Update reducer unit tests**

Open `services/ledger/ledger-ctrl/test/handlers/reducer.test.ts`. Find every assertion that mentions `version` (search for `version`). For each assertion that expects the call to `saveSnapshotWithEvents` to receive `version: <something>`, remove the `version` field from the expected object. For each setup that puts `version: <something>` on the existing snapshot, remove it.

Example transformation — if you find:

```typescript
expect(mockRepo.saveSnapshotWithEvents).toHaveBeenCalledWith(
  expect.objectContaining({
    version: 2,
    state: expect.any(Object),
  }),
  expect.any(Object),
);
```

Change it to:

```typescript
expect(mockRepo.saveSnapshotWithEvents).toHaveBeenCalledWith(
  expect.objectContaining({
    state: expect.any(Object),
  }),
  expect.any(Object),
);
```

If a test asserted on `version: currentVersion + 1` semantics specifically (e.g., a test named "increments version"), delete that test entirely — the behavior no longer exists.

- [ ] **Step 4: Update repository unit tests**

Open `services/ledger/ledger-ctrl/test/repositories/ledger.repository.test.ts`. Find every assertion that mentions `version` (search for `version`).

For each `sk` assertion, change `BalanceEvent#${now}#${version}` patterns to `BalanceEvent#${now}#${lastEventSequence}` (similarly for PortfolioEvent and LedgerEntryEvent). The existing test inputs probably set `version: 5` and `lastEventSequence: 12` separately — if so, the new sk uses `lastEventSequence` (12 in that example).

For each Item assertion, remove the `version: <number>` field from the expected DDB Item.

Update the `data` argument passed to `saveSnapshotWithEvents` in test setup to drop `version: <number>`.

- [ ] **Step 5: Run reducer + repository unit tests**

Run: `pnpm nx test ledger-ctrl -- --testPathPatterns="reducer|ledger.repository"`

Expected: PASS — both files green. If a test fails because you missed a `version` reference, find it and update it.

- [ ] **Step 6: Run all ledger-ctrl unit tests**

Run: `pnpm nx test ledger-ctrl`

Expected: PASS — all unit tests green. (Integration tests are not run here.)

- [ ] **Step 7: Commit**

```bash
git add services/ledger/ledger-ctrl/src/handlers/reducer.ts \
        services/ledger/ledger-ctrl/src/repositories/ledger.repository.ts \
        services/ledger/ledger-ctrl/test/handlers/reducer.test.ts \
        services/ledger/ledger-ctrl/test/repositories/ledger.repository.test.ts
git commit -m "$(cat <<'EOF'
refactor(ledger-ctrl): drop version field, use lastEventSequence as sk discriminator

Replaces the per-invocation version counter with the deterministic
lastEventSequence high-water mark. Same N events → same final state →
same sk values. Removes a vestigial field with no consumers across
the codebase (verified by full grep).

Snapshot/BalanceEvent/PortfolioEvent/LedgerEntryEvent rows lose the
'version' attribute. The three event-row sk patterns change from
\${typename}#\${now}#\${version} to \${typename}#\${now}#\${lastEventSequence}.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Revert version workarounds in integration-testing lib

**Context:** Task 1 dropped `version` from ledger-ctrl. The two workarounds shipped in commit `9365b67` (adding `'version'` to `DYNAMIC_FIELDS`) and the corresponding test input become unnecessary. Also drop `version: 1` from the account-seeding fixture, which was added defensively for compatibility with the field.

**Files:**
- Modify: `libs/integration-testing/src/fixtures/account-seeding.fixture.ts:57`
- Modify: `libs/integration-testing/src/resilience.ts:3-7`
- Modify: `libs/integration-testing/test/resilience.test.ts:5,18`

- [ ] **Step 1: Drop version from account-seeding fixture**

In `libs/integration-testing/src/fixtures/account-seeding.fixture.ts`, find line 57 (`version: 1,`) inside the seed `item` object and delete it. The seed item should now look like (with the old line removed):

```typescript
const item = {
  pk,
  sk,
  __typename: 'AccountSnapshot',
  tenantId: this.ctx.tenantId,
  timestamp: now,
  streamType,
  positions: options?.positions ?? {},
  cashBalanceCents: options?.cashBalanceCents ?? 1_000_000,
  totalValueCents: options?.cashBalanceCents ?? 1_000_000,
  positionCount: Object.keys(options?.positions ?? {}).length,
  lastEventSequence: 0,
  snapshotAt: now,
};
```

- [ ] **Step 2: Revert `'version'` from DYNAMIC_FIELDS**

In `libs/integration-testing/src/resilience.ts`, change the `DYNAMIC_FIELDS` set:

```typescript
const DYNAMIC_FIELDS = new Set([
  'pk', 'sk', 'tenantId', 'userId',
  'createdAt', 'updatedAt', 'timestamp', 'snapshotAt',
  'ttl', 'eventId', 'sourceEventId', 'sequenceNo',
]);
```

The set goes from 13 elements (with `'version'`) back to 12 elements. `snapshotAt` stays.

- [ ] **Step 3: Revert version from the resilience helpers unit test**

In `libs/integration-testing/test/resilience.test.ts`, find the first test (line 5):

```typescript
it('removes pk, sk, tenantId, userId, timestamps, eventId, sequenceNo, ttl, snapshotAt, version', () => {
```

Change the description to remove `, version`:

```typescript
it('removes pk, sk, tenantId, userId, timestamps, eventId, sequenceNo, ttl, snapshotAt', () => {
```

Then in the test input object, remove the `version: 3,` line. The input should look like:

```typescript
const item = {
  pk: 'Account#tenant-1#actual',
  sk: 'Event#abc-123',
  tenantId: 'tenant-1',
  userId: 'user-1',
  createdAt: '2026-04-10T00:00:00Z',
  updatedAt: '2026-04-10T00:00:00Z',
  timestamp: '2026-04-10T00:00:00Z',
  snapshotAt: '2026-04-10T00:00:00Z',
  ttl: 1712793600,
  eventId: 'abc-123',
  sourceEventId: 'abc-123',
  sequenceNo: 1,
  __typename: 'LedgerEntry',
  eventType: 'ORDER_FILLED',
  payload: { symbol: 'AAPL', quantity: 10 },
};
```

The expected output stays the same (it never included `version`).

- [ ] **Step 4: Run integration-testing unit tests**

Run: `pnpm nx test integration-testing`

Expected: PASS — all 7 resilience.test.ts tests still green plus the event-bridge-client test.

- [ ] **Step 5: Commit**

```bash
git add libs/integration-testing/src/fixtures/account-seeding.fixture.ts \
        libs/integration-testing/src/resilience.ts \
        libs/integration-testing/test/resilience.test.ts
git commit -m "$(cat <<'EOF'
refactor(integration-testing): revert version workarounds after ledger-ctrl drops field

Now that ledger-ctrl no longer writes 'version' to AccountSnapshot/derived
rows, the DYNAMIC_FIELDS workaround from 9365b67 and the seed compat
field can be reverted.

DYNAMIC_FIELDS goes 13 → 12 fields ('snapshotAt' stays).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Validate ledger-ctrl resilience integration test still passes after Task 1+2

**Context:** Tasks 1 and 2 changed the ledger-ctrl snapshot shape. The resilience integration test for ledger-ctrl should still pass without the `version` field in the comparison. This task is a validation step — no code changes unless the test fails.

**Files:**
- Run only: `services/ledger/ledger-ctrl/test/integration/ledger-ctrl.resilience.integration.test.ts`

- [ ] **Step 1: Run the ledger-ctrl resilience integration test**

Run: `pnpm nx run ledger-ctrl:test-integration -- --testPathPatterns=resilience`

Expected: All 5 tests PASS on first attempt with no retries. Total runtime ~6-7 minutes.

If a test fails:
- **Idempotency tests fail** → not expected, the changes don't touch dedup logic. Stop and report.
- **Pairwise / full shuffle fails with snapshot diff** → check what fields differ. If something other than `version` shows up, investigate. The expected outcome is that snapshots are deep-equal after `stripDynamicFields` runs.
- **Test doesn't compile** → check the resilience test for any references to `version` that need to be removed (it shouldn't, but verify).

- [ ] **Step 2: No commit needed** (validation only). If the test passed, proceed to Task 4.

---

### Task 4: Add auto-delete + in-memory dedup to EventBusTrap

**Context:** `EventBusTrap.waitForEvent` and `drain` consume SQS messages without deleting them, so visibility-timeout expiry causes re-receives in subsequent calls. The fix is two-layer: auto-delete on receive (best-effort) + in-memory `MessageId` Set as a safety net.

**Files:**
- Modify: `libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts`
- Create: `libs/integration-testing/test/fixtures/event-bus-trap.test.ts`

- [ ] **Step 1: Write the failing unit test**

Create `libs/integration-testing/test/fixtures/event-bus-trap.test.ts`:

```typescript
import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { SQSClient, ReceiveMessageCommand, DeleteMessageBatchCommand } from '@aws-sdk/client-sqs';
import { EventBridgeClient as AwsEbClient } from '@aws-sdk/client-eventbridge';
import { EventBusTrap } from '../../src/fixtures/event-bus-trap.fixture';
import type { IntegrationContext } from '../../src/context';

const sqsMock = mockClient(SQSClient);
mockClient(AwsEbClient);

function makeMessage(id: string, detailType: string) {
  return {
    MessageId: id,
    ReceiptHandle: `rh-${id}`,
    Body: JSON.stringify({
      'detail-type': detailType,
      detail: { id: `evt-${id}` },
      source: 'test',
      time: '2026-04-10T00:00:00Z',
    }),
  };
}

function makeCtx(): IntegrationContext {
  return {
    region: 'us-east-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    timings: { eventTimeout: 5_000, pollInterval: 100, putEventRetries: 1, putEventBackoffMs: 100 },
    cleanup: { register: jest.fn(), runAll: jest.fn() },
    ssm: { busArn: jest.fn().mockResolvedValue('arn:aws:events:us-east-1:111111111111:event-bus/test') },
  } as unknown as IntegrationContext;
}

describe('EventBusTrap dedup + auto-delete', () => {
  beforeEach(() => {
    sqsMock.reset();
  });

  it('drain dedupes messages by MessageId across receive calls', async () => {
    const trap = new EventBusTrap(makeCtx());
    // Inject a deployed queue URL via private field access (test-only)
    (trap as unknown as { queueUrl: string }).queueUrl = 'https://sqs.test/queue';

    // First receive returns msg-1; second receive (simulating visibility timeout
    // re-receive) returns the same msg-1 plus a new msg-2.
    sqsMock
      .on(ReceiveMessageCommand)
      .resolvesOnce({ Messages: [makeMessage('msg-1', 'EVENT_A')] })
      .resolvesOnce({ Messages: [makeMessage('msg-1', 'EVENT_A'), makeMessage('msg-2', 'EVENT_B')] });

    sqsMock.on(DeleteMessageBatchCommand).resolves({});

    const first = await trap.drain();
    const second = await trap.drain();

    expect(first).toHaveLength(1);
    expect(first[0].detailType).toBe('EVENT_A');
    expect(second).toHaveLength(1); // only msg-2, msg-1 already seen
    expect(second[0].detailType).toBe('EVENT_B');
  });

  it('drain calls DeleteMessageBatchCommand after every receive', async () => {
    const trap = new EventBusTrap(makeCtx());
    (trap as unknown as { queueUrl: string }).queueUrl = 'https://sqs.test/queue';

    sqsMock
      .on(ReceiveMessageCommand)
      .resolves({ Messages: [makeMessage('msg-x', 'EVENT_X')] });
    sqsMock.on(DeleteMessageBatchCommand).resolves({});

    await trap.drain();

    expect(sqsMock).toHaveReceivedCommandWith(DeleteMessageBatchCommand, {
      QueueUrl: 'https://sqs.test/queue',
      Entries: [{ Id: 'msg-x', ReceiptHandle: 'rh-msg-x' }],
    });
  });

  it('drain continues even when DeleteMessageBatch fails (best-effort)', async () => {
    const trap = new EventBusTrap(makeCtx());
    (trap as unknown as { queueUrl: string }).queueUrl = 'https://sqs.test/queue';

    sqsMock
      .on(ReceiveMessageCommand)
      .resolves({ Messages: [makeMessage('msg-y', 'EVENT_Y')] });
    sqsMock.on(DeleteMessageBatchCommand).rejects(new Error('SQS down'));

    const result = await trap.drain();

    expect(result).toHaveLength(1);
    expect(result[0].detailType).toBe('EVENT_Y');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx test integration-testing -- --testPathPatterns=event-bus-trap`

Expected: FAIL — the trap fixture doesn't yet call `DeleteMessageBatchCommand` and doesn't track `seenMessageIds`.

- [ ] **Step 3: Add `DeleteMessageBatchCommand` import**

In `libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts`, find the existing SQS import and add `DeleteMessageBatchCommand`:

```typescript
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageBatchCommand,
} from '@aws-sdk/client-sqs';
```

(Keep any other imports from `@aws-sdk/client-sqs` that already existed.)

- [ ] **Step 4: Add `seenMessageIds` field**

In the `EventBusTrap` class body, near the existing private fields (around line 28 where `private captured: CapturedEvent[] = [];` is declared), add:

```typescript
private readonly seenMessageIds = new Set<string>();
```

- [ ] **Step 5: Add a `consumeMessages` private helper**

Add a private method to the class that handles the receive → delete → dedup pattern. Place it just before the `waitForEvent` method:

```typescript
private async consumeMessages(waitTimeSeconds: number): Promise<CapturedEvent[]> {
  const result = await this.sqs.send(new ReceiveMessageCommand({
    QueueUrl: this.queueUrl!,
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: waitTimeSeconds,
  }));

  const messages = result.Messages ?? [];
  if (messages.length === 0) return [];

  // Best-effort delete to free SQS storage and prevent visibility-timeout re-receives
  const deletable = messages
    .filter(m => m.MessageId && m.ReceiptHandle)
    .map(m => ({ Id: m.MessageId!, ReceiptHandle: m.ReceiptHandle! }));
  if (deletable.length > 0) {
    try {
      await this.sqs.send(new DeleteMessageBatchCommand({
        QueueUrl: this.queueUrl!,
        Entries: deletable,
      }));
    } catch (error) {
      // Best-effort: in-memory dedup below catches re-receives if delete fails
      // Note: not using logger here because the fixture doesn't import one;
      // a console.warn is acceptable in test infrastructure.
      // eslint-disable-next-line no-console
      console.warn('EventBusTrap: DeleteMessageBatch failed (best-effort, continuing)', error);
    }
  }

  const fresh: CapturedEvent[] = [];
  for (const msg of messages) {
    if (!msg.MessageId || this.seenMessageIds.has(msg.MessageId)) continue;
    this.seenMessageIds.add(msg.MessageId);
    const body = JSON.parse(msg.Body!);
    fresh.push({
      detailType: body['detail-type'],
      detail: body.detail,
      source: body.source,
      time: body.time,
    });
  }
  return fresh;
}
```

- [ ] **Step 6: Refactor `waitForEvent` to use `consumeMessages`**

In `waitForEvent`, replace the inline `ReceiveMessageCommand` block (around lines 175-198) with a call to the helper. The full replaced inner loop becomes:

```typescript
while (Date.now() < deadline) {
  // Check captured buffer first
  if (params?.detailType) {
    const match = this.captured.find(e => e.detailType === params.detailType);
    if (match) {
      this.captured = this.captured.filter(e => e !== match);
      return match as CapturedEvent<TDetail>;
    }
  } else if (this.captured.length > 0) {
    return this.captured.shift()! as CapturedEvent<TDetail>;
  }

  // Poll SQS via the dedup-aware helper
  const fresh = await this.consumeMessages(
    Math.min(5, Math.max(1, Math.ceil((deadline - Date.now()) / 1000))),
  );

  for (const event of fresh) {
    if (params?.detailType && event.detailType === params.detailType) {
      return event as CapturedEvent<TDetail>;
    }
    if (!params?.detailType) {
      return event as CapturedEvent<TDetail>;
    }
    // Buffer non-matching events for the next iteration
    this.captured.push(event);
  }

  if (fresh.length === 0) {
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
}
```

- [ ] **Step 7: Refactor `drain` to use `consumeMessages`**

Replace the existing `drain()` method body (lines 208-229) with:

```typescript
async drain(): Promise<CapturedEvent[]> {
  const fresh = await this.consumeMessages(0);
  const events: CapturedEvent[] = [...this.captured, ...fresh];
  this.captured = [];
  return events;
}
```

- [ ] **Step 8: Run the unit test to verify it passes**

Run: `pnpm nx test integration-testing -- --testPathPatterns=event-bus-trap`

Expected: PASS — all 3 new tests green.

- [ ] **Step 9: Run all integration-testing unit tests**

Run: `pnpm nx test integration-testing`

Expected: PASS — the existing resilience.test.ts and event-bridge-client.test.ts still green, plus the new event-bus-trap.test.ts.

- [ ] **Step 10: Commit**

```bash
git add libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts \
        libs/integration-testing/test/fixtures/event-bus-trap.test.ts
git commit -m "$(cat <<'EOF'
fix(integration-testing): EventBusTrap auto-delete + in-memory MessageId dedup

Two layers of defense against SQS at-least-once re-receive:
1. After every ReceiveMessageCommand, immediately call
   DeleteMessageBatchCommand on the receipt handles (best-effort —
   delete failures log a warning and continue)
2. Track seen MessageIds in a per-trap Set; subsequent receives skip
   any message id already returned

Fixes the false-positive failure pattern in ledger-ctrl resilience CDC
test where trap.drain() returned a BalanceEvent already consumed by
waitForEvent (visibility timeout expiry → re-delivery).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Revert ledger-ctrl detail.id filter workaround

**Context:** Task 4 fixed the EventBusTrap so re-receives never surface. The workaround in commit `2af1997` (capture `firstEmissionId` and filter re-receives by `detail.id`) is now unnecessary. Revert to the simpler `expect(balanceEvents).toHaveLength(0)` assertion. Keep the timeout bumps (`waitForEvent` 120s, test 360s) — those are independent latency calibration.

**Files:**
- Modify: `services/ledger/ledger-ctrl/test/integration/ledger-ctrl.resilience.integration.test.ts:183-204`

- [ ] **Step 1: Replace the workaround block**

In `services/ledger/ledger-ctrl/test/integration/ledger-ctrl.resilience.integration.test.ts`, locate the `'duplicate ORDER_FILLED does not emit duplicate BALANCE_UPDATED CDC'` test (around line 155). The current body of the wait/drain section uses `firstEmissionId` capture and a `detail.id` filter. Replace it with the simpler form:

Find this block (lines around 183-201):

```typescript
      const firstEvent = await trap.waitForEvent({
        detailType: 'BALANCE_UPDATED',
        timeoutMs: 120_000,
      });
      // Capture the first emission's id so we can distinguish a real
      // duplicate emission from an SQS at-least-once re-receive of the
      // same event (which is harmless and unrelated to dedup).
      const firstEmissionId = (firstEvent.detail as { id?: string } | undefined)?.id;

      // Duplicate publish
      await cdcEb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-ctrl',
        detailType: 'ORDER_FILLED',
        detail: payload,
        eventId,
      });

      // Wait for any duplicate CDC event — match the first-event timeout
      // so a late duplicate can't produce a false negative.
      await new Promise((r) => setTimeout(r, 60_000));

      // Drain remaining events. Filter out re-receives of the first
      // emission (same detail.id) — those are SQS at-least-once artifacts
      // and don't indicate dedup failure. A real dedup failure would
      // produce a NEW BalanceEvent with a different detail.id (since the
      // event-publisher generates a fresh envelope per stream record).
      const remaining = await trap.drain();
      const newBalanceEvents = remaining.filter((e) => {
        if (e.detailType !== 'BALANCE_UPDATED') return false;
        const emissionId = (e.detail as { id?: string } | undefined)?.id;
        return emissionId !== firstEmissionId;
      });
      expect(newBalanceEvents).toHaveLength(0);
```

Replace with:

```typescript
      await trap.waitForEvent({
        detailType: 'BALANCE_UPDATED',
        timeoutMs: 120_000,
      });

      // Duplicate publish
      await cdcEb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-ctrl',
        detailType: 'ORDER_FILLED',
        detail: payload,
        eventId,
      });

      // Wait for any duplicate CDC event — match the first-event timeout
      // so a late duplicate can't produce a false negative.
      await new Promise((r) => setTimeout(r, 60_000));

      // Drain remaining events — should be empty. The trap's auto-delete
      // + in-memory dedup ensures we never see the first emission again.
      const remaining = await trap.drain();
      const balanceEvents = remaining.filter((e) => e.detailType === 'BALANCE_UPDATED');
      expect(balanceEvents).toHaveLength(0);
```

Keep the test timeout `360_000` and the surrounding try/finally structure.

- [ ] **Step 2: Run the ledger-ctrl resilience integration test**

Run: `pnpm nx run ledger-ctrl:test-integration -- --testPathPatterns=resilience`

Expected: All 5 tests PASS on first attempt. The CDC test should pass with the simpler assertion now that the trap fixture deduplicates re-receives.

- [ ] **Step 3: Commit**

```bash
git add services/ledger/ledger-ctrl/test/integration/ledger-ctrl.resilience.integration.test.ts
git commit -m "$(cat <<'EOF'
test(ledger-ctrl): revert detail.id re-receive filter after EventBusTrap fix

The workaround from 2af1997 is no longer needed — EventBusTrap now
deduplicates re-receives at the fixture layer via auto-delete +
in-memory MessageId Set.

Restores the simpler expect(balanceEvents).toHaveLength(0) assertion.
Timeout bumps stay (waitForEvent 120s, test 360s) — those are
independent latency calibration for parallel-load runs.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Tolerate already-resolved SF tasks in `resumeStateMachine`

**Context:** `resume-state-machine.ts:41` always calls `SendTaskSuccessCommand`. When a duplicate event arrives, the original already resolved the SF task, so the duplicate's call throws `TaskTimedOut`, `InvalidToken`, or `TaskDoesNotExist`. The current code catches at line 49, tries `SendTaskFailureCommand` (which also fails), and re-throws — Lambda errors → SQS retries → DLQ. Fix: wrap `SendTaskSuccessCommand` in its own try/catch and treat the three "already resolved" error names as success. All three names verified against `@aws-sdk/client-sfn@3.1011.0` `SendTaskSuccessCommand.d.ts:57-77`.

**Files:**
- Modify: `libs/event-processor/src/pipelines/resume-state-machine.ts:36-69`
- Modify: `libs/event-processor/test/pipelines/resume-state-machine.test.ts`

- [ ] **Step 1: Write the failing tests**

Open `libs/event-processor/test/pipelines/resume-state-machine.test.ts`. Add three new tests inside the existing `describe('resumeStateMachine', () => { ... })` block, after the existing `'serializes output to JSON string in SendTaskSuccessCommand'` test:

```typescript
  it('treats SendTaskSuccess TaskTimedOut as success (duplicate event)', async () => {
    const taskTimedOut = new Error('Task already closed');
    taskTimedOut.name = 'TaskTimedOut';
    sfnMock.on(SendTaskSuccessCommand).rejects(taskTimedOut);

    const handler = resumeStateMachine({
      serviceName: 'test-svc',
      handlers: {
        TEST_EVENT: async () => ({ output: { result: 'ok' } }),
      },
    });

    const result = await handler(makeSqsEvent('TEST_EVENT', { taskToken: 'tok-dup-1' }));

    // Lambda should succeed — no batch item failure, no SendTaskFailure call
    expect(result.batchItemFailures).toHaveLength(0);
    expect(sfnMock).not.toHaveReceivedCommand(SendTaskFailureCommand);
  });

  it('treats SendTaskSuccess InvalidToken as success (duplicate event)', async () => {
    const invalidToken = new Error('Invalid token');
    invalidToken.name = 'InvalidToken';
    sfnMock.on(SendTaskSuccessCommand).rejects(invalidToken);

    const handler = resumeStateMachine({
      serviceName: 'test-svc',
      handlers: {
        TEST_EVENT: async () => ({ output: { result: 'ok' } }),
      },
    });

    const result = await handler(makeSqsEvent('TEST_EVENT', { taskToken: 'tok-dup-2' }));

    expect(result.batchItemFailures).toHaveLength(0);
    expect(sfnMock).not.toHaveReceivedCommand(SendTaskFailureCommand);
  });

  it('treats SendTaskSuccess TaskDoesNotExist as success (duplicate event)', async () => {
    const taskGone = new Error('Task does not exist');
    taskGone.name = 'TaskDoesNotExist';
    sfnMock.on(SendTaskSuccessCommand).rejects(taskGone);

    const handler = resumeStateMachine({
      serviceName: 'test-svc',
      handlers: {
        TEST_EVENT: async () => ({ output: { result: 'ok' } }),
      },
    });

    const result = await handler(makeSqsEvent('TEST_EVENT', { taskToken: 'tok-dup-3' }));

    expect(result.batchItemFailures).toHaveLength(0);
    expect(sfnMock).not.toHaveReceivedCommand(SendTaskFailureCommand);
  });

  it('still propagates other SendTaskSuccess errors', async () => {
    const otherError = new Error('something else broke');
    otherError.name = 'KmsAccessDeniedException';
    sfnMock.on(SendTaskSuccessCommand).rejects(otherError);

    const handler = resumeStateMachine({
      serviceName: 'test-svc',
      handlers: {
        TEST_EVENT: async () => ({ output: { result: 'ok' } }),
      },
    });

    const result = await handler(makeSqsEvent('TEST_EVENT', { taskToken: 'tok-real-failure' }));

    // Real error should fall through to the outer catch → SendTaskFailure → retryable
    expect(sfnMock).toHaveReceivedCommand(SendTaskFailureCommand);
    expect(result.batchItemFailures).toHaveLength(1);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm nx test event-processor -- --testPathPatterns=resume-state-machine`

Expected: 4 new tests FAIL — current code re-throws all `SendTaskSuccess` errors, so the duplicate cases incorrectly trigger `SendTaskFailureCommand` and produce batch failures.

- [ ] **Step 3: Update `resumeStateMachine` to catch the three error names**

In `libs/event-processor/src/pipelines/resume-state-machine.ts`, find the inner `try` block (lines 37-48) inside the `wrappedHandlers[eventType]` function. Replace the inner `try` body (the section that calls `resumeHandler` and then `sfnClient.send(new SendTaskSuccessCommand(...))`) with a nested try/catch around just the `SendTaskSuccessCommand` call:

```typescript
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
          if (sfnError instanceof Error && (
            sfnError.name === 'TaskTimedOut' ||
            sfnError.name === 'InvalidToken' ||
            sfnError.name === 'TaskDoesNotExist'
          )) {
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
        // existing outer catch — unchanged
        if (error instanceof NotRetryableError) {
          throw error;
        }

        const err = error instanceof Error ? error : new Error(String(error));

        try {
          await sfnClient.send(new SendTaskFailureCommand({
            taskToken,
            error: err.message,
            cause: err.name,
          }));
        } catch (sfnError) {
          logger.error('Failed to send task failure to SFN', { sfnError, originalError: err.message });
        }

        throw error;
      }
```

The only change is the addition of the nested try/catch around `sfnClient.send(new SendTaskSuccessCommand(...))`. The outer try/catch is unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm nx test event-processor -- --testPathPatterns=resume-state-machine`

Expected: All tests PASS — the 4 new tests for the duplicate-tolerance behavior, plus the 6 existing tests still green.

- [ ] **Step 5: Run all event-processor unit tests**

Run: `pnpm nx test event-processor`

Expected: PASS — no regression in any other pipeline test.

- [ ] **Step 6: Commit**

```bash
git add libs/event-processor/src/pipelines/resume-state-machine.ts \
        libs/event-processor/test/pipelines/resume-state-machine.test.ts
git commit -m "$(cat <<'EOF'
fix(event-processor): resumeStateMachine tolerates already-resolved SF tasks

When a duplicate event arrives (SQS at-least-once), the original
already resolved the SF task. The duplicate's SendTaskSuccessCommand
throws TaskTimedOut / InvalidToken / TaskDoesNotExist. Previously this
crashed the Lambda → SQS retries → DLQ.

Wrap the SendTaskSuccessCommand call in its own try/catch and treat
those three error names as success. Other errors propagate to the
existing outer catch unchanged.

All three error names verified against @aws-sdk/client-sfn@3.1011.0
SendTaskSuccessCommand.d.ts:57-77. TaskTimedOut explicitly documents
"task associated with the token has already been closed".

Benefits all services using resumeStateMachine, not just
portfolio-engine-ctrl.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Make `agent-service.runPipeline` idempotent

**Context:** `agent-service.ts:27` generates `invocationId = randomUUID()`, so duplicate events produce distinct IN_PROGRESS+COMPLETED rows AND run Bedrock twice. Fix: derive sk from `ctx.eventId`, wrap the IN_PROGRESS write in `attribute_not_exists(sk)`, throw `DuplicateInvocationError` on conditional check failure. The COMPLETED write stays unconditional (overwrites IN_PROGRESS at the same sk). Add `ttl: now + 3600` to the IN_PROGRESS write so orphaned locks self-expire after 1 hour.

**Files:**
- Modify: `services/advisory/portfolio-engine-ctrl/src/agent-service.ts`
- Modify: `services/advisory/portfolio-engine-ctrl/test/agent-service.test.ts`

- [ ] **Step 1: Update existing tests for the new signature**

Open `services/advisory/portfolio-engine-ctrl/test/agent-service.test.ts`. The current tests call `service.runPipeline({ tenantId, decisionId, ... })`. They need to call `service.runPipeline('eventId', { ... })` after the change.

Update both existing tests to pass an `eventId` as the first argument:

```typescript
  it('should invoke orchestrator and return allocations + trades', async () => {
    mockInvokeOrchestrator.mockResolvedValue({
      'portfolio-construction': { allocations: [{ instrument: 'VTI', targetWeight: 0.6 }] },
      'rebalance-planner': { trades: [{ action: 'BUY', instrument: 'VTI' }] },
    });

    const service = createAgentService(deps);
    const result = await service.runPipeline('evt-1', {
      tenantId: 't1',
      decisionId: 'dp-1',
      taskToken: 'token',
      context: { riskCategory: 'MODERATE' },
    });

    expect(result).toMatchObject({
      decisionId: 'dp-1',
      allocations: expect.objectContaining({ allocations: expect.any(Array) }),
      trades: expect.objectContaining({ trades: expect.any(Array) }),
      metadata: expect.objectContaining({ modelTiers: ['opus', 'sonnet'] }),
    });
    expect(ddbMock).toHaveReceivedCommandTimes(PutCommand, 2); // IN_PROGRESS + COMPLETED
  });

  it('should propagate orchestrator errors', async () => {
    mockInvokeOrchestrator.mockRejectedValue(new Error('Orchestrator failure'));

    const service = createAgentService(deps);
    await expect(service.runPipeline('evt-2', {
      tenantId: 't1', decisionId: 'dp-2', taskToken: 'token',
    })).rejects.toThrow('Orchestrator failure');
  });
```

- [ ] **Step 2: Add new failing tests for the lock behavior**

Append two new tests to the same `describe` block in `agent-service.test.ts`:

```typescript
  it('uses INV#${eventId} as the sk and adds attribute_not_exists condition + ttl on IN_PROGRESS write', async () => {
    mockInvokeOrchestrator.mockResolvedValue({
      'portfolio-construction': {},
      'rebalance-planner': {},
    });

    const service = createAgentService(deps);
    await service.runPipeline('evt-lock-1', {
      tenantId: 't1',
      decisionId: 'dp-lock',
      taskToken: 'tok',
    });

    // First PutCommand should be the IN_PROGRESS lock acquisition
    const calls = ddbMock.commandCalls(PutCommand);
    expect(calls.length).toBe(2); // IN_PROGRESS + COMPLETED

    const inProgressArgs = calls[0].args[0].input;
    expect(inProgressArgs.Item).toMatchObject({
      pk: 'DECISION#dp-lock',
      sk: 'INV#evt-lock-1',
      __typename: 'AgentInvocation',
      invocationId: 'evt-lock-1',
      decisionId: 'dp-lock',
      tenantId: 't1',
      status: 'IN_PROGRESS',
    });
    expect(inProgressArgs.Item?.ttl).toEqual(expect.any(Number));
    expect(inProgressArgs.ConditionExpression).toBe('attribute_not_exists(sk)');

    // Second PutCommand is the COMPLETED overwrite — same sk, no condition
    const completedArgs = calls[1].args[0].input;
    expect(completedArgs.Item).toMatchObject({
      pk: 'DECISION#dp-lock',
      sk: 'INV#evt-lock-1',
      status: 'COMPLETED',
    });
    expect(completedArgs.ConditionExpression).toBeUndefined();
  });

  it('throws DuplicateInvocationError when conditional check fails (duplicate event)', async () => {
    const conditionalFailure = new Error('The conditional request failed');
    conditionalFailure.name = 'ConditionalCheckFailedException';
    ddbMock.on(PutCommand).rejectsOnce(conditionalFailure);

    const { DuplicateInvocationError } = await import('../src/agent-service');
    const service = createAgentService(deps);

    await expect(service.runPipeline('evt-dup', {
      tenantId: 't1',
      decisionId: 'dp-dup',
      taskToken: 'tok',
    })).rejects.toThrow(DuplicateInvocationError);

    // Bedrock must NOT have been called on the duplicate
    expect(mockInvokeOrchestrator).not.toHaveBeenCalled();
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm nx test portfolio-engine-ctrl -- --testPathPatterns=agent-service`

Expected: The two new tests FAIL. The existing two tests probably also fail because the signature changed.

- [ ] **Step 4: Update `agent-service.ts`**

Replace the entire contents of `services/advisory/portfolio-engine-ctrl/src/agent-service.ts` with:

```typescript
import { createOrchestrator, invokeOrchestrator } from '@nestfolio/agent-orchestrator';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { portfolioConstructionConfig } from './agents/portfolio-construction.config';
import { rebalancePlannerConfig } from './agents/rebalance-planner.config';
import { PortfolioEngineState } from './agents/state';

export interface AgentServiceDeps {
  readonly docClient: DynamoDBDocumentClient;
  readonly tableName: string;
}

export class DuplicateInvocationError extends Error {
  readonly eventId: string;
  constructor(eventId: string) {
    super(`Duplicate agent invocation for eventId ${eventId}`);
    this.name = 'DuplicateInvocationError';
    this.eventId = eventId;
  }
}

const LOCK_TTL_SECONDS = 3600; // 1 hour — orphaned IN_PROGRESS locks self-expire

export const createAgentService = (deps: AgentServiceDeps) => {
  const orchestrator = createOrchestrator({
    agents: {
      'portfolio-construction': portfolioConstructionConfig,
      'rebalance-planner': rebalancePlannerConfig,
    },
    waves: [
      { agents: ['portfolio-construction', 'rebalance-planner'] },
    ],
    stateAnnotation: PortfolioEngineState,
  });

  return {
    runPipeline: async (eventId: string, event: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const startedAt = new Date().toISOString();
      const subject = (event.subject ?? event) as Record<string, unknown>;
      const decisionId = subject.decisionId as string;
      const tenantId = subject.tenantId as string;
      const sk = `INV#${eventId}`;
      const ttl = Math.floor(Date.now() / 1000) + LOCK_TTL_SECONDS;

      // Acquire the invocation lock — atomic via attribute_not_exists.
      // Duplicate events fail this check and short-circuit before invoking Bedrock.
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

      // Run the agent pipeline (Bedrock orchestration).
      const result = await invokeOrchestrator(orchestrator, {
        tenantId,
        decisionId,
        upstreamOutputs: subject.context ?? subject.upstreamOutputs ?? {},
      });

      const completedAt = new Date().toISOString();
      const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

      // Mark the invocation complete. Unconditional overwrite at the same sk;
      // this drops the ttl so completed records persist indefinitely.
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

The key changes from the previous version:
1. `randomUUID` import dropped
2. `DuplicateInvocationError` exported
3. `LOCK_TTL_SECONDS` constant
4. `runPipeline` signature: `(eventId, event)` instead of `(event)`
5. `sk = INV#${eventId}` instead of `INV#${invocationId}`
6. IN_PROGRESS write has `ConditionExpression: 'attribute_not_exists(sk)'` and `ttl` field
7. Catches `ConditionalCheckFailedException` → throws `DuplicateInvocationError`
8. COMPLETED write is unconditional (no ConditionExpression), drops the `ttl` field

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm nx test portfolio-engine-ctrl -- --testPathPatterns=agent-service`

Expected: All 4 tests PASS (2 existing + 2 new).

- [ ] **Step 6: Commit**

```bash
git add services/advisory/portfolio-engine-ctrl/src/agent-service.ts \
        services/advisory/portfolio-engine-ctrl/test/agent-service.test.ts
git commit -m "$(cat <<'EOF'
fix(portfolio-engine-ctrl): idempotent agent-service via INV#\${eventId} sk + conditional write

Replaces randomUUID-derived invocationId with the deterministic
ctx.eventId. The IN_PROGRESS write uses attribute_not_exists(sk) to
acquire an atomic lock; duplicate events fail the check and throw
DuplicateInvocationError before invoking Bedrock.

The IN_PROGRESS row carries ttl = now + 3600s so orphaned locks
(Lambda crashes mid-Bedrock) self-expire after 1 hour. The COMPLETED
write is unconditional and drops the ttl, so finished invocations
persist.

runPipeline signature changes from (event) to (eventId, event).
Caller update follows in the next commit (event-listener.ts).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Update `event-listener.ts` to pass `eventId` and catch `DuplicateInvocationError`

**Context:** Task 7 changed the `runPipeline` signature. The handler in `event-listener.ts:35` needs to pass `ctx.eventId` and catch `DuplicateInvocationError` to return a deduplicated response without intents (so the existing `record('AgentInvocation', ...)` intent doesn't fire and the SF callback handling proceeds gracefully).

**Files:**
- Modify: `services/advisory/portfolio-engine-ctrl/src/handlers/event-listener.ts:1-49`
- Modify: `services/advisory/portfolio-engine-ctrl/test/event-listener.test.ts`

- [ ] **Step 1: Inspect the existing event-listener test**

Read `services/advisory/portfolio-engine-ctrl/test/event-listener.test.ts` to understand its current structure (mocks, test patterns). You'll need to update the existing CONSTRUCT_PORTFOLIO test to pass through `ctx.eventId` and add a new test for the `DuplicateInvocationError` path.

- [ ] **Step 2: Update existing event-listener tests + add the duplicate test**

In `services/advisory/portfolio-engine-ctrl/test/event-listener.test.ts`, the existing CONSTRUCT_PORTFOLIO test mocks `agentService.runPipeline`. Update the assertion to verify it was called with `(ctx.eventId, event)`:

If the existing test looks like:

```typescript
expect(mockAgentService.runPipeline).toHaveBeenCalledWith(
  expect.objectContaining({ tenantId: 't1', decisionId: 'dp-1' })
);
```

Change to:

```typescript
expect(mockAgentService.runPipeline).toHaveBeenCalledWith(
  expect.any(String), // ctx.eventId
  expect.objectContaining({ tenantId: 't1', decisionId: 'dp-1' })
);
```

Add a new test for the duplicate path. Place it in the same `describe` block as the other CONSTRUCT_PORTFOLIO tests:

```typescript
  it('returns deduplicated output without intents when DuplicateInvocationError is thrown', async () => {
    const { DuplicateInvocationError } = await import('../src/agent-service');
    mockAgentService.runPipeline.mockRejectedValueOnce(new DuplicateInvocationError('evt-dup'));

    const handlers = createHandlers({
      agentService: mockAgentService,
      kbIngestionHandler: mockKbIngestionHandler,
      memoryClient: mockMemoryClient,
    });

    const result = await handlers['CONSTRUCT_PORTFOLIO'](
      { subject: { tenantId: 't1', decisionId: 'dp-dup', taskToken: 'tok' } },
      { eventId: 'evt-dup', eventType: 'CONSTRUCT_PORTFOLIO', tenantId: 't1', userId: 'u1', region: 'us-east-1', timestamp: '2026-04-10T00:00:00Z', serviceName: 'portfolio-engine-ctrl', record: {} } as never,
    );

    expect(result.output).toMatchObject({ decisionId: 'dp-dup', tenantId: 't1', deduplicated: true });
    expect(result.intents).toBeUndefined();
  });
```

If the existing test file uses different mock variable names (`mockAgentService`, `mockKbIngestionHandler`, `mockMemoryClient`), match them. The point is to call the handler with a `ctx` that has an `eventId`, mock `runPipeline` to throw `DuplicateInvocationError`, and assert the deduplicated output.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm nx test portfolio-engine-ctrl -- --testPathPatterns=event-listener`

Expected: The new test FAILS — current handler doesn't catch `DuplicateInvocationError`. The updated existing test may also fail if the current handler doesn't pass `ctx.eventId`.

- [ ] **Step 4: Update the handler**

In `services/advisory/portfolio-engine-ctrl/src/handlers/event-listener.ts`, update the imports and the CONSTRUCT_PORTFOLIO handler.

First, add `DuplicateInvocationError` to the imports from `../agent-service`:

```typescript
import { createAgentService, DuplicateInvocationError } from '../agent-service';
```

Then update the `SfnCallbackDeps` interface so `runPipeline` matches the new signature:

```typescript
export interface SfnCallbackDeps {
  readonly agentService: { runPipeline: (eventId: string, event: Record<string, unknown>) => Promise<Record<string, unknown>> };
  readonly kbIngestionHandler: { ingest: (event: Record<string, unknown>, eventType: string) => Promise<void> };
  readonly memoryClient: MemoryClient;
}
```

Then replace the CONSTRUCT_PORTFOLIO handler body (lines 20-49) with:

```typescript
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

The diff:
1. New import of `DuplicateInvocationError`
2. Updated `SfnCallbackDeps` interface with the new `runPipeline` signature
3. The `agentService.runPipeline` call now passes `ctx.eventId` as the first argument and is wrapped in try/catch
4. On `DuplicateInvocationError`, the handler returns `{ output: { decisionId, tenantId, deduplicated: true } }` without any intents

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm nx test portfolio-engine-ctrl -- --testPathPatterns=event-listener`

Expected: PASS — the updated existing test and the new duplicate test both green.

- [ ] **Step 6: Run all portfolio-engine-ctrl unit tests**

Run: `pnpm nx test portfolio-engine-ctrl`

Expected: PASS — agent-service, event-listener, and any other unit tests still green.

- [ ] **Step 7: Commit**

```bash
git add services/advisory/portfolio-engine-ctrl/src/handlers/event-listener.ts \
        services/advisory/portfolio-engine-ctrl/test/event-listener.test.ts
git commit -m "$(cat <<'EOF'
fix(portfolio-engine-ctrl): handler passes eventId, catches DuplicateInvocationError

Wires up the new agent-service signature: pass ctx.eventId as the
first argument to runPipeline. On DuplicateInvocationError, return
{ deduplicated: true } without intents — the existing
record('AgentInvocation') intent doesn't fire, and resumeStateMachine
(now duplicate-tolerant after the previous task) handles the SF
callback gracefully.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Tighten portfolio-engine-ctrl integration test

**Context:** Task 8 of the predecessor plan relaxed the idempotency assertion to a bounded `[firstCount, firstCount+1]` check because the test caught a real bug (random invocationIds produce duplicate rows). With Tasks 7+8 in place, the test can now assert exactly `1` AgentInvocation row per duplicate-publish pair.

**Files:**
- Modify: `services/advisory/portfolio-engine-ctrl/test/integration/portfolio-engine-ctrl.resilience.integration.test.ts`

- [ ] **Step 1: Inspect the current relaxed assertion**

Read `services/advisory/portfolio-engine-ctrl/test/integration/portfolio-engine-ctrl.resilience.integration.test.ts` and find the idempotency test (`'duplicate CONSTRUCT_PORTFOLIO does not create duplicate AgentInvocation'`). Locate the relaxed assertion — it should look something like:

```typescript
expect(itemsAfter.length).toBeGreaterThanOrEqual(countBefore);
expect(itemsAfter.length).toBeLessThanOrEqual(countBefore + 1);
```

or possibly:

```typescript
expect(itemsAfter.length).toBe(countBefore); // or countBefore + 1 — relaxed
```

(The exact form depends on how the implementer in Task 8 of the predecessor plan wrote it.)

- [ ] **Step 2: Tighten the assertion to exactly 1 row**

Replace the relaxed bounded check with:

```typescript
// After Tasks 7 + 8: agent-service is fully idempotent. The AgentInvocation
// row at INV#${ctx.eventId} is created once on first delivery, and the
// duplicate's conditional write fails → DuplicateInvocationError → handler
// returns deduplicated → no second row.
expect(itemsAfter.length).toBe(countBefore);
```

If the original test counted items at `pk: DECISION#${decisionId}` and asserted on the count, the new assertion is the same — duplicate publishes do not increment the count.

If the original used a different counting strategy (e.g., counting items with a specific status), use whichever counting strategy is in the file but assert exact equality with `countBefore`.

The pre-flight count `countBefore` should still be 1 (the first publish), and `countAfter` should also be 1 after the duplicate publish.

- [ ] **Step 3: Drop any obsolete commentary**

If the test has a comment block explaining the relaxed assertion (e.g., "agent-service has no eventId-keyed dedup, so duplicate may produce a second row" or similar), delete that comment block. The new assertion is unconditional.

- [ ] **Step 4: Run the portfolio-engine-ctrl resilience integration test**

Run: `pnpm nx run portfolio-engine-ctrl:test-integration -- --testPathPatterns=resilience`

Expected: Both tests PASS on first attempt. The idempotency test should produce exactly 1 AgentInvocation row even after the duplicate publish. Total runtime ~2-3 minutes.

If the idempotency test fails:
- **`countAfter` is 2** → Tasks 7 or 8 didn't apply correctly. Check that `agent-service.ts` uses `INV#${eventId}` and that `event-listener.ts` passes `ctx.eventId` and catches the error.
- **`countAfter` is 0** → the FIRST publish didn't write (lock acquisition failed, or Bedrock failed). Check the Lambda logs.
- **`waitForItem` times out before reaching the assertion** → AgentRuntime may be unavailable. The test was previously tolerant of this; preserve the tolerant code path.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/portfolio-engine-ctrl/test/integration/portfolio-engine-ctrl.resilience.integration.test.ts
git commit -m "$(cat <<'EOF'
test(portfolio-engine-ctrl): tighten idempotency assertion to exact count

agent-service is now fully idempotent (INV#\${eventId} sk + conditional
write + DuplicateInvocationError). The previously-relaxed
[n, n+1] bound becomes exactly toBe(countBefore).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Final parallel validation

**Context:** All four sections of the spec are implemented and committed. Run the full parallel integration test command to verify all 16 resilience tests pass on first attempt with zero retries — the success criterion from the spec.

**Files:**
- None — validation only.

- [ ] **Step 1: Run the full parallel validation**

```bash
pnpm nx run-many -t test-integration \
  --projects=ledger-ctrl,execution-ctrl,broker-ctrl,reconciliation-ctrl,broker-alpaca-adpt,portfolio-engine-ctrl \
  --parallel=2 -- --testPathPatterns=resilience
```

Expected: All 16 tests PASS across 6 services. Total wallclock ~15-20 minutes.

- [ ] **Step 2: Verify zero retries**

Search the output for "RETRY". Expected: zero matches.

```bash
grep -c "RETRY" /tmp/last-validation-output 2>/dev/null || echo "ok"
```

(If you redirected the run output to a file, grep that file. Otherwise visually scan the terminal output.)

If any test required a retry to pass:
- **portfolio-engine-ctrl** — likely AgentRuntime unavailability; check Lambda logs
- **ledger-ctrl** — should not retry; if it does, check for snapshot diffs that include unexpected fields
- **other services** — likely shared infra latency; consider whether timeouts need further bumping

- [ ] **Step 3: Verify exit code is 0**

The Nx command should exit with code 0 and print:

```
NX   Successfully ran target test-integration for 6 projects
```

If exit code is non-zero, identify which project failed and re-investigate.

- [ ] **Step 4: No commit needed** — validation only.

---

## Summary

After this plan:

| Workaround | Origin commit | Reverted in task |
|-----------|---------------|------------------|
| `'version'` in `DYNAMIC_FIELDS` + test input | `9365b67` | Task 2 |
| `version: 1` in account-seeding fixture | (predecessor work) | Task 2 |
| `firstEmissionId` / `detail.id` filter in ledger-ctrl test | `2af1997` | Task 5 |
| `[n, n+1]` relaxation in portfolio-engine-ctrl test | predecessor Task 8 | Task 9 |

| Workaround | Status |
|-----------|--------|
| reconciliation-ctrl timeout bumps (180s → 300s, 360s → 600s) | **Preserved** — independent latency calibration |
| ledger-ctrl `waitForEvent` 90s → 120s, test 240s → 360s | **Preserved** — independent latency calibration |

| New architectural feature | Where |
|--------------------------|-------|
| `DuplicateInvocationError` exported error class | `agent-service.ts` (Task 7) |
| Idempotent invocation tracking via deterministic sk + TTL | `agent-service.ts` (Task 7) |
| `EventBusTrap` MessageId dedup + auto-delete | `event-bus-trap.fixture.ts` (Task 4) |
| `resumeStateMachine` tolerates already-resolved tasks | `resume-state-machine.ts` (Task 6) — benefits ALL services using `resumeStateMachine` |
| ledger-ctrl uses `lastEventSequence` as sk discriminator | `ledger.repository.ts` (Task 1) |

**Success criteria:**
1. All four spec sections implemented
2. All workarounds reverted
3. Latency calibrations preserved
4. Final parallel run: 16/16 tests pass on first attempt with zero retries
