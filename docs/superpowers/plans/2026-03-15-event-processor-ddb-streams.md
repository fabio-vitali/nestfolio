# Event Processor DDB Stream Pipelines — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add DDB Stream pipelines (createStreamHandler, changeDataCapture, replayAndReduce) and the deferred SQS preset (materializeToBucket) to @nestfolio/event-processor.

**Architecture:** StreamEngine parallels BatchEngine — shared BaseCollector and ErrorEventPublisher for consistency. Stream handlers return void (own I/O). CDC uses inline EventBridgePublisher. replayAndReduce uses query-since-checkpoint with convention-based default query.

**Tech Stack:** TypeScript, @aws-sdk/lib-dynamodb, @aws-sdk/client-eventbridge, @aws-sdk/client-s3, p-limit, jest

**Spec:** `docs/superpowers/specs/2026-03-15-event-processor-ddb-streams-design.md`

**Branch:** `feat/remove-idempotency-guard`

**Test runner:** `npx nx test event-processor`

**All source files under:** `libs/event-processor/src/`
**All test files under:** `libs/event-processor/test/`

---

## Chunk 1: Shared Infrastructure (BaseCollector, ErrorEventPublisher, SQS backfill)

### Task 1: Extract BaseCollector

**Files:**
- Create: `libs/event-processor/src/engine/base-collector.ts`
- Modify: `libs/event-processor/src/engine/error-collector.ts`
- Create: `libs/event-processor/test/engine/base-collector.test.ts`

- [ ] **Step 1: Write failing tests for BaseCollector**

```typescript
// test/engine/base-collector.test.ts
import { BaseCollector } from '../../src/engine/base-collector';

// Create a concrete subclass for testing
class TestCollector extends BaseCollector {
  constructor() {
    super({
      TestProcessed: 0,
      TestFailed: 0,
      TestBatchSize: 0,
    });
  }
}

describe('BaseCollector', () => {
  let collector: TestCollector;

  beforeEach(() => {
    collector = new TestCollector();
  });

  it('starts with empty errors', () => {
    const errors = collector.getErrors();
    expect(errors.retryable).toEqual([]);
    expect(errors.nonRetryable).toEqual([]);
  });

  it('records success and increments metric', () => {
    collector.recordSuccess('r-1');
    collector.incrementMetric('TestProcessed');
    expect(collector.getMetrics().TestProcessed).toBe(1);
  });

  it('classifies retryable errors', () => {
    collector.recordError('r-1', new Error('timeout'), true, { eventType: 'X' });
    const errors = collector.getErrors();
    expect(errors.retryable).toHaveLength(1);
    expect(errors.retryable[0].causedBy).toEqual({ eventType: 'X' });
    expect(errors.nonRetryable).toHaveLength(0);
  });

  it('classifies non-retryable errors', () => {
    collector.recordError('r-1', new Error('bad data'), false, { eventType: 'Y' });
    const errors = collector.getErrors();
    expect(errors.retryable).toHaveLength(0);
    expect(errors.nonRetryable).toHaveLength(1);
  });

  it('tracks both retryable and non-retryable in same batch', () => {
    collector.recordError('r-1', new Error('timeout'), true, { a: 1 });
    collector.recordError('r-2', new Error('bad'), false, { b: 2 });
    const errors = collector.getErrors();
    expect(errors.retryable).toHaveLength(1);
    expect(errors.nonRetryable).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test event-processor --testPathPattern=base-collector`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement BaseCollector**

```typescript
// src/engine/base-collector.ts

export interface CollectedError {
  readonly id: string;
  readonly error: Error;
  readonly retryable: boolean;
  readonly causedBy: unknown;
}

export abstract class BaseCollector {
  protected readonly metrics: Record<string, number>;
  private readonly retryableErrors: CollectedError[] = [];
  private readonly nonRetryableErrors: CollectedError[] = [];

  constructor(initialMetrics: Record<string, number>) {
    this.metrics = { ...initialMetrics };
  }

  recordSuccess(id: string): void {
    // Subclasses increment their own metrics via incrementMetric
  }

  recordError(id: string, error: Error, retryable: boolean, causedBy: unknown): void {
    const entry: CollectedError = { id, error, retryable, causedBy };
    if (retryable) {
      this.retryableErrors.push(entry);
    } else {
      this.nonRetryableErrors.push(entry);
    }
  }

  incrementMetric(name: string, count = 1): void {
    this.metrics[name] = (this.metrics[name] ?? 0) + count;
  }

  getErrors(): { retryable: CollectedError[]; nonRetryable: CollectedError[] } {
    return {
      retryable: [...this.retryableErrors],
      nonRetryable: [...this.nonRetryableErrors],
    };
  }

  getMetrics(): Record<string, number> {
    return { ...this.metrics };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test event-processor --testPathPattern=base-collector`
Expected: PASS (5 tests)

- [ ] **Step 5: Refactor ErrorCollector to extend BaseCollector**

Modify `src/engine/error-collector.ts` — the public API stays the same (existing tests must still pass), but internals delegate to `BaseCollector`. Key changes:
- `extends BaseCollector` with SQS-specific initial metrics
- `recordSuccess`, `recordDeduplicated`, `recordPoisonPill`, `recordSkipped` call `incrementMetric`
- `recordError` calls `super.recordError(id, error, retryable, causedBy)` + handles `batchItemFailures` and `droppedErrors`
- `getResults()` composes from `getErrors()` and `getMetrics()`

```typescript
// src/engine/error-collector.ts
import { BaseCollector } from './base-collector';

export interface CollectorResults {
  metrics: Record<string, number>;
  batchItemFailures: string[];
  droppedErrors: Array<{ messageId: string; eventType: string; error: Error; causedBy?: unknown }>;
}

export class ErrorCollector extends BaseCollector {
  private readonly failures: string[] = [];
  private readonly dropped: Array<{ messageId: string; eventType: string; error: Error; causedBy?: unknown }> = [];

  constructor() {
    super({
      EventProcessed: 0,
      EventFailed: 0,
      EventDeduplicated: 0,
      EventDropped: 0,
      PoisonPillDetected: 0,
      EventSkipped: 0,
      BatchSize: 0,
    });
  }

  override recordSuccess(messageId: string, eventType?: string): void {
    super.recordSuccess(messageId);
    this.incrementMetric('EventProcessed');
    this.incrementMetric('BatchSize');
  }

  recordDeduplicated(messageId: string, eventType: string): void {
    this.incrementMetric('EventDeduplicated');
    this.incrementMetric('BatchSize');
  }

  override recordError(messageId: string, error: Error, retryable: boolean, causedBy?: unknown): void;
  override recordError(messageId: string, eventType: string, error: Error, retryable: boolean): void;
  override recordError(...args: unknown[]): void {
    // Support both new signature (id, error, retryable, causedBy) and legacy (id, eventType, error, retryable)
    let messageId: string, eventType: string, error: Error, retryable: boolean, causedBy: unknown;
    if (args[1] instanceof Error) {
      [messageId, error, retryable, causedBy] = args as [string, Error, boolean, unknown];
      eventType = 'UNKNOWN';
    } else {
      [messageId, eventType, error, retryable] = args as [string, string, Error, boolean];
      causedBy = undefined;
    }

    super.recordError(messageId, error, retryable, causedBy);
    this.incrementMetric('BatchSize');
    if (retryable) {
      this.incrementMetric('EventFailed');
      this.failures.push(messageId);
    } else {
      this.incrementMetric('EventDropped');
      this.dropped.push({ messageId, eventType, error, causedBy });
    }
  }

  recordPoisonPill(messageId: string): void {
    this.incrementMetric('PoisonPillDetected');
    this.incrementMetric('BatchSize');
  }

  recordSkipped(messageId: string): void {
    this.incrementMetric('EventSkipped');
    this.incrementMetric('BatchSize');
  }

  getResults(): CollectorResults {
    return {
      metrics: this.getMetrics(),
      batchItemFailures: [...this.failures],
      droppedErrors: [...this.dropped],
    };
  }
}
```

- [ ] **Step 6: Run ALL existing tests to verify no regression**

Run: `npx nx test event-processor`
Expected: ALL PASS (67 tests)

- [ ] **Step 7: Commit**

```bash
git add libs/event-processor/src/engine/base-collector.ts libs/event-processor/src/engine/error-collector.ts libs/event-processor/test/engine/base-collector.test.ts
git commit -m "refactor: extract BaseCollector from ErrorCollector for engine consistency"
```

---

### Task 2: ErrorEventPublisher + SQS backfill

**Files:**
- Create: `libs/event-processor/src/engine/error-event-publisher.ts`
- Modify: `libs/event-processor/src/engine/batch-engine.ts`
- Create: `libs/event-processor/test/engine/error-event-publisher.test.ts`

- [ ] **Step 1: Write failing tests for ErrorEventPublisher**

```typescript
// test/engine/error-event-publisher.test.ts
import { ErrorEventPublisher } from '../../src/engine/error-event-publisher';

// Mock EventBridge client
const mockSend = jest.fn();
jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  PutEventsCommand: jest.fn().mockImplementation((input) => input),
}));

describe('ErrorEventPublisher', () => {
  let publisher: ErrorEventPublisher;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({ FailedEntryCount: 0 });
    publisher = new ErrorEventPublisher('test-bus', 'test-service');
  });

  it('publishes non-retryable errors with causedBy', async () => {
    await publisher.publishErrors(
      [{ error: new Error('bad data'), causedBy: { eventType: 'ORDER_FILLED' } }],
      'TEST_SERVICE_FAILED',
    );
    expect(mockSend).toHaveBeenCalledTimes(1);
    const call = mockSend.mock.calls[0][0];
    const detail = JSON.parse(call.Entries[0].Detail);
    expect(detail.subject.causedBy).toEqual({ eventType: 'ORDER_FILLED' });
    expect(detail.subject.error).toBe('bad data');
  });

  it('includes groupKey when provided', async () => {
    await publisher.publishErrors(
      [{ error: new Error('fail'), causedBy: {}, groupKey: 't1#actual' }],
      'TEST_STREAM_FAILED',
    );
    const detail = JSON.parse(mockSend.mock.calls[0][0].Entries[0].Detail);
    expect(detail.subject.groupKey).toBe('t1#actual');
  });

  it('swallows publish failures (fire-and-forget)', async () => {
    mockSend.mockRejectedValue(new Error('network error'));
    // Should NOT throw
    await expect(
      publisher.publishErrors(
        [{ error: new Error('original'), causedBy: {} }],
        'TEST_FAILED',
      ),
    ).resolves.toBeUndefined();
  });

  it('continues publishing remaining errors if one fails', async () => {
    mockSend.mockRejectedValueOnce(new Error('fail-1')).mockResolvedValueOnce({ FailedEntryCount: 0 });
    await publisher.publishErrors(
      [
        { error: new Error('err-1'), causedBy: { a: 1 } },
        { error: new Error('err-2'), causedBy: { b: 2 } },
      ],
      'TEST_FAILED',
    );
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('does nothing for empty errors array', async () => {
    await publisher.publishErrors([], 'TEST_FAILED');
    expect(mockSend).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test event-processor --testPathPattern=error-event-publisher`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement ErrorEventPublisher**

```typescript
// src/engine/error-event-publisher.ts
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { logger, getUUID, getTime } from '@nestfolio/lambda-utils';

export class ErrorEventPublisher {
  private readonly client: EventBridgeClient;

  constructor(
    private readonly busName: string,
    private readonly serviceName: string,
    client?: EventBridgeClient,
  ) {
    this.client = client ?? new EventBridgeClient({});
  }

  async publishErrors(
    errors: Array<{ error: Error; causedBy: unknown; groupKey?: string }>,
    errorEventType: string,
  ): Promise<void> {
    for (const { error, causedBy, groupKey } of errors) {
      try {
        const detail = {
          id: getUUID(),
          type: errorEventType,
          timestamp: getTime(),
          subject: {
            error: error.message,
            stack: error.stack,
            causedBy,
            ...(groupKey && { groupKey }),
          },
          context: { serviceName: this.serviceName },
        };

        await this.client.send(new PutEventsCommand({
          Entries: [{
            EventBusName: this.busName,
            Source: `${this.busName}@${this.serviceName}`,
            DetailType: errorEventType,
            Detail: JSON.stringify(detail),
          }],
        }));
      } catch (pubErr) {
        logger.warn('Failed to publish error event', {
          pubErr: pubErr instanceof Error ? pubErr.message : String(pubErr),
          originalError: error.message,
        });
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test event-processor --testPathPattern=error-event-publisher`
Expected: PASS (5 tests)

- [ ] **Step 5: Backfill BatchEngine to use ErrorEventPublisher + add causedBy**

Modify `src/engine/batch-engine.ts`:
1. Import `ErrorEventPublisher`
2. Create publisher in constructor (only if `busName` is provided)
3. Replace the unguarded `for` loop (lines 112-117) with `this.errorPublisher.publishErrors()`
4. Pass `causedBy` (the parsed event payload) through the error collector — modify the catch block to pass the parsed event body as `causedBy`

Key change: declare `parsedPayload` before the try block, populate it after `parseRecord`, and pass it as `causedBy` in the catch:

```typescript
// Before the try block, add:
let parsedPayload: unknown;

// After parseRecord succeeds (~line 59), add:
parsedPayload = { type: uow.event.type, subject: uow.event.subject, id: uow.event.id };

// In the catch block (~line 100-104), change from:
collector.recordError(messageId, 'UNKNOWN', err, retryable);
// To:
collector.recordError(messageId, 'UNKNOWN', err, retryable);
// Note: the legacy overload in ErrorCollector stores causedBy=undefined.
// To pass causedBy, use the new overload: (id, error, retryable, causedBy)
// But we must keep the legacy call for backward compat. Instead, update the catch to:
```

Full catch block replacement:
```typescript
} catch (error) {
  const err = error instanceof Error ? error : new Error(String(error));
  const retryable = isRetryable(err);
  // Pass parsedPayload as causedBy (may be undefined if parse itself failed)
  collector.recordError(messageId, err, retryable, parsedPayload);
}
```

This uses the NEW overload signature `(id, error, retryable, causedBy)` where `args[1] instanceof Error` routes to the new path.
And the post-batch error publishing (~lines 111-117):
```typescript
if (results.droppedErrors.length > 0 && this.config.busName) {
  const errorType = this.config.errorEventType ?? `${this.config.serviceName.toUpperCase().replace(/-/g, '_')}_FAILED`;
  for (const { error } of results.droppedErrors) {
    await publishErrorEvent({ name: this.config.busName } as any, errorType, error);
  }
}
```
Becomes:
```typescript
if (results.droppedErrors.length > 0 && this.errorPublisher) {
  const errorType = this.config.errorEventType ?? `${this.config.serviceName.toUpperCase().replace(/-/g, '_')}_FAILED`;
  await this.errorPublisher.publishErrors(
    results.droppedErrors.map(({ error, causedBy }) => ({ error, causedBy })),
    errorType,
  );
}
```

- [ ] **Step 6: Run ALL existing tests to verify no regression**

Run: `npx nx test event-processor`
Expected: ALL PASS (67 + 5 + 5 = 77 tests)

- [ ] **Step 7: Commit**

```bash
git add libs/event-processor/src/engine/error-event-publisher.ts libs/event-processor/src/engine/batch-engine.ts libs/event-processor/test/engine/error-event-publisher.test.ts
git commit -m "feat: add ErrorEventPublisher with fire-and-forget guard, backfill BatchEngine"
```

---

## Chunk 2: StreamEngine Core (unmarshalStream, StreamCollector, StreamEngine)

### Task 3: unmarshalStream utility

**Files:**
- Create: `libs/event-processor/src/util/unmarshal-stream.ts`
- Create: `libs/event-processor/test/util/unmarshal-stream.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// test/util/unmarshal-stream.test.ts
import { unmarshalStream } from '../../src/util/unmarshal-stream';
import { fakeDdbStreamRecord } from '../../src/testing/fake-records';

describe('unmarshalStream', () => {
  it('unmarshals INSERT record with NewImage', () => {
    const ddbRecord = fakeDdbStreamRecord('INSERT', {
      pk: 'T#t1', sk: 'Order#e1', __typename: 'Order', tenantId: 't1', amount: 100,
    });
    const result = unmarshalStream(ddbRecord, 'test-service');
    expect(result).not.toBeNull();
    expect(result!.streamRecord.pk).toBe('T#t1');
    expect(result!.streamRecord.sk).toBe('Order#e1');
    expect(result!.streamRecord.__typename).toBe('Order');
    expect(result!.streamRecord.tenantId).toBe('t1');
    expect(result!.streamRecord.amount).toBe(100);
    expect(result!.ctx.eventName).toBe('INSERT');
    expect(result!.ctx.typename).toBe('Order');
    expect(result!.ctx.newImage).toBeDefined();
    expect(result!.ctx.oldImage).toBeUndefined();
  });

  it('unmarshals REMOVE record using OldImage', () => {
    const ddbRecord = fakeDdbStreamRecord('REMOVE', {
      pk: 'T#t1', sk: 'Order#e1', __typename: 'Order', tenantId: 't1',
    });
    const result = unmarshalStream(ddbRecord, 'test-service');
    expect(result).not.toBeNull();
    expect(result!.ctx.eventName).toBe('REMOVE');
    expect(result!.ctx.newImage).toBeUndefined();
    expect(result!.ctx.oldImage).toBeDefined();
  });

  it('unmarshals MODIFY record with both images', () => {
    const ddbRecord = fakeDdbStreamRecord('MODIFY', {
      pk: 'T#t1', sk: 'Order#e1', __typename: 'Order', tenantId: 't1', amount: 200,
    }, { oldImage: { pk: 'T#t1', sk: 'Order#e1', __typename: 'Order', tenantId: 't1', amount: 100 } });
    const result = unmarshalStream(ddbRecord, 'test-service');
    expect(result!.ctx.newImage!.amount).toBe(200);
    expect(result!.ctx.oldImage!.amount).toBe(100);
  });

  it('returns null for record with no image', () => {
    const ddbRecord = fakeDdbStreamRecord('REMOVE', {
      pk: 'T#t1', sk: 'Order#e1', __typename: 'Order', tenantId: 't1',
    });
    // Remove OldImage to simulate NEW_IMAGE-only stream
    ddbRecord.dynamodb!.OldImage = undefined;
    const result = unmarshalStream(ddbRecord, 'test-service');
    expect(result).toBeNull();
  });

  it('sets serviceName in context', () => {
    const ddbRecord = fakeDdbStreamRecord('INSERT', {
      pk: 'T#t1', sk: 'Order#e1', __typename: 'Order', tenantId: 't1',
    });
    const result = unmarshalStream(ddbRecord, 'my-service');
    expect(result!.ctx.serviceName).toBe('my-service');
  });

  it('preserves raw DynamoDBRecord in context', () => {
    const ddbRecord = fakeDdbStreamRecord('INSERT', {
      pk: 'T#t1', sk: 'Order#e1', __typename: 'Order', tenantId: 't1',
    });
    const result = unmarshalStream(ddbRecord, 'test');
    expect(result!.ctx.record).toBe(ddbRecord);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test event-processor --testPathPattern=unmarshal-stream`
Expected: FAIL (module not found)

- [ ] **Step 2.5: Add `eventName` to StreamRecord type**

Modify `src/types/stream-types.ts` — add `eventName` field to `StreamRecord`:
```typescript
export interface StreamRecord {
  readonly pk: string;
  readonly sk: string;
  readonly __typename: string;
  readonly tenantId: string;
  readonly eventName: 'INSERT' | 'MODIFY' | 'REMOVE';  // NEW — carried per-record for CDC groupBy
  readonly sequenceNo?: number;
  readonly [key: string]: unknown;
}
```

This is needed because CDC's `processGroup` receives records from multiple DDB stream events. When grouped, each record needs its own `eventName` to resolve the correct event type from `eventTypeMap`. Without this, all records in a group would use the first record's `ctx.eventName`.

- [ ] **Step 3: Implement unmarshalStream**

```typescript
// src/util/unmarshal-stream.ts
import type { DynamoDBRecord } from 'aws-lambda';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import type { StreamRecord, StreamContext } from '../types/stream-types';

export function unmarshalStream(
  record: DynamoDBRecord,
  serviceName: string,
): { streamRecord: StreamRecord; ctx: StreamContext } | null {
  const eventName = record.eventName as 'INSERT' | 'MODIFY' | 'REMOVE';
  const image = eventName === 'REMOVE'
    ? record.dynamodb?.OldImage
    : record.dynamodb?.NewImage;

  if (!image) return null;

  const unmarshalled = unmarshall(image as Record<string, AttributeValue>);

  const oldImageRaw = record.dynamodb?.OldImage;
  const oldImage = (oldImageRaw && oldImageRaw !== image)
    ? unmarshall(oldImageRaw as Record<string, AttributeValue>)
    : (eventName === 'REMOVE' ? unmarshalled : undefined);

  return {
    streamRecord: {
      pk: unmarshalled.pk as string,
      sk: unmarshalled.sk as string,
      __typename: unmarshalled.__typename as string,
      tenantId: unmarshalled.tenantId as string,
      eventName,  // carry per-record for CDC groupBy
      ...unmarshalled,
    } as StreamRecord,
    ctx: {
      serviceName,
      record,
      eventName,
      keys: { pk: unmarshalled.pk as string, sk: unmarshalled.sk as string },
      typename: unmarshalled.__typename as string,
      tenantId: unmarshalled.tenantId as string,
      newImage: eventName !== 'REMOVE' ? unmarshalled : undefined,
      oldImage,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test event-processor --testPathPattern=unmarshal-stream`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add libs/event-processor/src/util/unmarshal-stream.ts libs/event-processor/test/util/unmarshal-stream.test.ts
git commit -m "feat: add unmarshalStream utility for DDB Stream records"
```

---

### Task 4: StreamCollector

**Files:**
- Create: `libs/event-processor/src/engine/stream-collector.ts`
- Create: `libs/event-processor/test/engine/stream-collector.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// test/engine/stream-collector.test.ts
import { StreamCollector } from '../../src/engine/stream-collector';

describe('StreamCollector', () => {
  let collector: StreamCollector;

  beforeEach(() => {
    collector = new StreamCollector();
  });

  it('starts with zero metrics', () => {
    expect(collector.getMetrics().StreamRecordProcessed).toBe(0);
    expect(collector.getMetrics().StreamRecordFailed).toBe(0);
    expect(collector.getMetrics().StreamBatchSize).toBe(0);
  });

  it('tracks successful records', () => {
    collector.recordSuccess('r-1');
    expect(collector.getMetrics().StreamRecordProcessed).toBe(1);
    expect(collector.getMetrics().StreamBatchSize).toBe(1);
  });

  it('tracks retryable errors', () => {
    collector.recordError('r-1', new Error('timeout'), true, { pk: 'x' });
    expect(collector.getMetrics().StreamRecordFailed).toBe(1);
    expect(collector.hasRetryableErrors()).toBe(true);
  });

  it('tracks non-retryable errors', () => {
    collector.recordError('r-1', new Error('bad'), false, { pk: 'x' });
    expect(collector.getMetrics().StreamRecordFailed).toBe(1);
    expect(collector.hasRetryableErrors()).toBe(false);
  });

  it('hasRetryableErrors returns false when all errors non-retryable', () => {
    collector.recordError('r-1', new Error('bad'), false, {});
    collector.recordError('r-2', new Error('bad2'), false, {});
    expect(collector.hasRetryableErrors()).toBe(false);
  });

  it('getNonRetryableForPublishing returns errors with causedBy', () => {
    collector.recordError('r-1', new Error('bad data'), false, { eventType: 'ORDER' });
    const errors = collector.getNonRetryableForPublishing();
    expect(errors).toHaveLength(1);
    expect(errors[0].causedBy).toEqual({ eventType: 'ORDER' });
  });

  it('setBatchDuration sets metric', () => {
    collector.setBatchDuration(150);
    expect(collector.getMetrics().StreamBatchDuration).toBe(150);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test event-processor --testPathPattern=stream-collector`
Expected: FAIL

- [ ] **Step 3: Implement StreamCollector**

```typescript
// src/engine/stream-collector.ts
import { BaseCollector, type CollectedError } from './base-collector';

export class StreamCollector extends BaseCollector {
  constructor() {
    super({
      StreamRecordProcessed: 0,
      StreamRecordFailed: 0,
      StreamBatchSize: 0,
      StreamBatchDuration: 0,
    });
  }

  override recordSuccess(id: string): void {
    super.recordSuccess(id);
    this.incrementMetric('StreamRecordProcessed');
    this.incrementMetric('StreamBatchSize');
  }

  override recordError(id: string, error: Error, retryable: boolean, causedBy: unknown): void {
    super.recordError(id, error, retryable, causedBy);
    this.incrementMetric('StreamRecordFailed');
    this.incrementMetric('StreamBatchSize');
  }

  hasRetryableErrors(): boolean {
    return this.getErrors().retryable.length > 0;
  }

  getNonRetryableForPublishing(): Array<{ error: Error; causedBy: unknown; groupKey?: string }> {
    return this.getErrors().nonRetryable.map((e) => ({
      error: e.error,
      causedBy: e.causedBy,
    }));
  }

  setBatchDuration(ms: number): void {
    this.incrementMetric('StreamBatchDuration', ms);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test event-processor --testPathPattern=stream-collector`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add libs/event-processor/src/engine/stream-collector.ts libs/event-processor/test/engine/stream-collector.test.ts
git commit -m "feat: add StreamCollector for DDB Stream error classification"
```

---

### Task 5: StreamEngine

**Files:**
- Create: `libs/event-processor/src/engine/stream-engine.ts`
- Create: `libs/event-processor/test/engine/stream-engine.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// test/engine/stream-engine.test.ts
import { StreamEngine, type StreamEngineConfig } from '../../src/engine/stream-engine';
import { fakeDdbStreamRecord } from '../../src/testing/fake-records';
import type { DynamoDBStreamEvent } from 'aws-lambda';

// Mock ErrorEventPublisher
jest.mock('../../src/engine/error-event-publisher', () => ({
  ErrorEventPublisher: jest.fn().mockImplementation(() => ({
    publishErrors: jest.fn().mockResolvedValue(undefined),
  })),
}));

function makeEvent(records: ReturnType<typeof fakeDdbStreamRecord>[]): DynamoDBStreamEvent {
  return { Records: records };
}

describe('StreamEngine', () => {
  it('calls processRecord for each unmarshalled record', async () => {
    const processRecord = jest.fn().mockResolvedValue(undefined);
    const engine = new StreamEngine({
      serviceName: 'test',
      processRecord,
    });
    await engine.process(makeEvent([
      fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'A#1', __typename: 'A', tenantId: 't1' }),
      fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'A#2', __typename: 'A', tenantId: 't1' }),
    ]));
    expect(processRecord).toHaveBeenCalledTimes(2);
  });

  it('applies filter — skips non-matching records', async () => {
    const processRecord = jest.fn().mockResolvedValue(undefined);
    const engine = new StreamEngine({
      serviceName: 'test',
      filter: (r) => r.__typename === 'Order',
      processRecord,
    });
    await engine.process(makeEvent([
      fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'O#1', __typename: 'Order', tenantId: 't1' }),
      fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'G#1', __typename: 'Guard', tenantId: 't1' }),
    ]));
    expect(processRecord).toHaveBeenCalledTimes(1);
  });

  it('groups records and calls processGroup', async () => {
    const processGroup = jest.fn().mockResolvedValue(undefined);
    const engine = new StreamEngine({
      serviceName: 'test',
      groupBy: { key: (r) => r.tenantId },
      processGroup,
    });
    await engine.process(makeEvent([
      fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'A#1', __typename: 'A', tenantId: 't1' }),
      fakeDdbStreamRecord('INSERT', { pk: 'T#t2', sk: 'A#2', __typename: 'A', tenantId: 't2' }),
      fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'A#3', __typename: 'A', tenantId: 't1' }),
    ]));
    expect(processGroup).toHaveBeenCalledTimes(2);
    const t1Call = processGroup.mock.calls.find((c: unknown[]) => c[0] === 't1');
    expect(t1Call[1]).toHaveLength(2);
  });

  it('applies groupBy pick:last', async () => {
    const processGroup = jest.fn().mockResolvedValue(undefined);
    const engine = new StreamEngine({
      serviceName: 'test',
      groupBy: { key: (r) => r.tenantId, pick: 'last' },
      processGroup,
    });
    await engine.process(makeEvent([
      fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'A#1', __typename: 'A', tenantId: 't1', v: 1 }),
      fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'A#2', __typename: 'A', tenantId: 't1', v: 2 }),
    ]));
    expect(processGroup).toHaveBeenCalledTimes(1);
    // pick:last wraps single record in array for processGroup
    expect(processGroup.mock.calls[0][1]).toHaveLength(1);
    expect(processGroup.mock.calls[0][1][0].v).toBe(2);
  });

  it('does not throw when all records process successfully', async () => {
    const engine = new StreamEngine({
      serviceName: 'test',
      processRecord: jest.fn().mockResolvedValue(undefined),
    });
    await expect(engine.process(makeEvent([
      fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'A#1', __typename: 'A', tenantId: 't1' }),
    ]))).resolves.toBeUndefined();
  });

  it('throws StreamBatchError when retryable error occurs', async () => {
    const engine = new StreamEngine({
      serviceName: 'test',
      processRecord: jest.fn().mockRejectedValue(new Error('timeout')),
    });
    await expect(engine.process(makeEvent([
      fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'A#1', __typename: 'A', tenantId: 't1' }),
    ]))).rejects.toThrow('StreamBatchError');
  });

  it('does NOT throw for non-retryable errors (publishes to bus)', async () => {
    const { NotRetryableError } = await import('@nestfolio/lambda-utils');
    const engine = new StreamEngine({
      serviceName: 'test',
      busName: 'test-bus',
      processRecord: jest.fn().mockRejectedValue(new NotRetryableError('bad data')),
    });
    await expect(engine.process(makeEvent([
      fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'A#1', __typename: 'A', tenantId: 't1' }),
    ]))).resolves.toBeUndefined();
  });

  it('skips records with no image (null from unmarshal)', async () => {
    const processRecord = jest.fn().mockResolvedValue(undefined);
    const engine = new StreamEngine({
      serviceName: 'test',
      processRecord,
    });
    const badRecord = fakeDdbStreamRecord('REMOVE', {
      pk: 'T#t1', sk: 'A#1', __typename: 'A', tenantId: 't1',
    });
    badRecord.dynamodb!.OldImage = undefined;

    await engine.process(makeEvent([badRecord]));
    expect(processRecord).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test event-processor --testPathPattern=stream-engine`
Expected: FAIL

- [ ] **Step 3: Implement StreamEngine**

```typescript
// src/engine/stream-engine.ts
import type { DynamoDBStreamEvent } from 'aws-lambda';
import { isRetryable, logger } from '@nestfolio/lambda-utils';
import type { StreamRecord, StreamContext } from '../types/stream-types';
import { unmarshalStream } from '../util/unmarshal-stream';
import { StreamCollector } from './stream-collector';
import { ErrorEventPublisher } from './error-event-publisher';
import { asyncPool } from '../util/async-pool';
import { groupBy as groupByUtil } from '../util/group-by';

const DEFAULT_CONCURRENCY = 3;

export class StreamBatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StreamBatchError';
  }
}

export interface StreamEngineConfig {
  serviceName: string;
  filter?: (record: StreamRecord) => boolean;
  groupBy?: {
    key: (record: StreamRecord) => string;
    pick?: 'first' | 'last' | 'all';
  };
  processRecord?: (record: StreamRecord, ctx: StreamContext) => Promise<void>;
  processGroup?: (groupKey: string, records: StreamRecord[], ctx: StreamContext) => Promise<void>;
  concurrency?: number;
  busName?: string;
  errorEventType?: string;
}

export class StreamEngine {
  private readonly config: StreamEngineConfig;
  private readonly errorPublisher?: ErrorEventPublisher;

  constructor(config: StreamEngineConfig) {
    this.config = config;
    if (config.busName) {
      this.errorPublisher = new ErrorEventPublisher(config.busName, config.serviceName);
    }
  }

  async process(event: DynamoDBStreamEvent): Promise<void> {
    const startedAt = Date.now();
    const collector = new StreamCollector();
    const concurrency = this.config.concurrency ?? DEFAULT_CONCURRENCY;

    // 1. Unmarshal
    const parsed: Array<{ streamRecord: StreamRecord; ctx: StreamContext }> = [];
    for (const ddbRecord of event.Records) {
      const result = unmarshalStream(ddbRecord, this.config.serviceName);
      if (!result) {
        logger.warn('Skipping record with no image', { eventID: ddbRecord.eventID });
        continue;
      }
      parsed.push(result);
    }

    // 2. Filter
    const filtered = this.config.filter
      ? parsed.filter((p) => this.config.filter!(p.streamRecord))
      : parsed;

    // 3. Process — per-record or per-group
    if (this.config.groupBy && this.config.processGroup) {
      const groups = groupByUtil(
        filtered,
        {
          key: (p) => this.config.groupBy!.key(p.streamRecord),
          pick: this.config.groupBy.pick ?? 'all',
        },
      );

      await asyncPool(
        Array.from(groups.entries()),
        async ([groupKey, items]) => {
          const records = Array.isArray(items) ? items : [items];
          // Use ctx from the first record in the group
          const ctx = records[0].ctx;
          const streamRecords = records.map((r) => r.streamRecord);
          try {
            await this.config.processGroup!(groupKey, streamRecords, ctx);
            collector.recordSuccess(groupKey);
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            collector.recordError(groupKey, err, isRetryable(err), streamRecords);
          }
        },
        { concurrency },
      );
    } else if (this.config.processRecord) {
      await asyncPool(
        filtered,
        async ({ streamRecord, ctx }) => {
          try {
            await this.config.processRecord!(streamRecord, ctx);
            collector.recordSuccess(ctx.record.eventID ?? 'unknown');
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            collector.recordError(
              ctx.record.eventID ?? 'unknown',
              err,
              isRetryable(err),
              streamRecord,
            );
          }
        },
        { concurrency },
      );
    }

    // 4. Post-batch: publish non-retryable errors
    const nonRetryable = collector.getNonRetryableForPublishing();
    if (nonRetryable.length > 0 && this.errorPublisher) {
      const errorType = this.config.errorEventType
        ?? `${this.config.serviceName.toUpperCase().replace(/-/g, '_')}_STREAM_FAILED`;
      await this.errorPublisher.publishErrors(nonRetryable, errorType);
    }

    // 5. Metrics
    collector.setBatchDuration(Date.now() - startedAt);

    // 6. Throw if retryable errors exist
    if (collector.hasRetryableErrors()) {
      const retryCount = collector.getErrors().retryable.length;
      throw new StreamBatchError(
        `${retryCount} retryable error(s) in stream batch — DDB Stream will retry`,
      );
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test event-processor --testPathPattern=stream-engine`
Expected: PASS (8 tests)

- [ ] **Step 5: Run ALL tests**

Run: `npx nx test event-processor`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add libs/event-processor/src/engine/stream-engine.ts libs/event-processor/test/engine/stream-engine.test.ts
git commit -m "feat: add StreamEngine — core DDB Stream batch processing loop"
```

---

## Chunk 3: Stream Pipelines (createStreamHandler, changeDataCapture, EventBridgePublisher)

### Task 6: createStreamHandler pipeline

**Files:**
- Create: `libs/event-processor/src/pipelines/create-stream-handler.ts`
- Create: `libs/event-processor/test/pipelines/create-stream-handler.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// test/pipelines/create-stream-handler.test.ts
import { createStreamHandler } from '../../src/pipelines/create-stream-handler';
import { fakeDdbStreamRecord } from '../../src/testing/fake-records';

jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
  PutEventsCommand: jest.fn(),
}));

describe('createStreamHandler', () => {
  it('returns a Lambda handler function', () => {
    const handler = createStreamHandler({
      serviceName: 'test',
      processRecord: jest.fn().mockResolvedValue(undefined),
    });
    expect(typeof handler).toBe('function');
  });

  it('processes records through processRecord', async () => {
    const processRecord = jest.fn().mockResolvedValue(undefined);
    const handler = createStreamHandler({
      serviceName: 'test',
      processRecord,
    });
    await handler({
      Records: [
        fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'A#1', __typename: 'A', tenantId: 't1' }),
      ],
    });
    expect(processRecord).toHaveBeenCalledTimes(1);
  });

  it('processes records through processGroup with groupBy', async () => {
    const processGroup = jest.fn().mockResolvedValue(undefined);
    const handler = createStreamHandler({
      serviceName: 'test',
      groupBy: { key: (r) => r.tenantId },
      processGroup,
    });
    await handler({
      Records: [
        fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'A#1', __typename: 'A', tenantId: 't1' }),
        fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'A#2', __typename: 'A', tenantId: 't1' }),
      ],
    });
    expect(processGroup).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test event-processor --testPathPattern=create-stream-handler`
Expected: FAIL

- [ ] **Step 3: Implement createStreamHandler**

```typescript
// src/pipelines/create-stream-handler.ts
import type { DynamoDBStreamEvent } from 'aws-lambda';
import type { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { StreamRecord, StreamContext } from '../types/stream-types';
import { StreamEngine } from '../engine/stream-engine';

export interface StreamHandlerConfig {
  serviceName: string;
  processRecord?: (record: StreamRecord, ctx: StreamContext) => Promise<void>;
  processGroup?: (groupKey: string, records: StreamRecord[], ctx: StreamContext) => Promise<void>;
  groupBy?: {
    key: (record: StreamRecord) => string;
    pick?: 'first' | 'last' | 'all';
  };
  filter?: (record: StreamRecord) => boolean;
  concurrency?: number;
  bus?: string | { name: string; client: EventBridgeClient };
  table?: string | { name: string; client: DynamoDBDocumentClient };
  errorEventType?: string;
}

export function createStreamHandler(
  config: StreamHandlerConfig,
): (event: DynamoDBStreamEvent) => Promise<void> {
  const busName = typeof config.bus === 'string'
    ? config.bus
    : config.bus?.name ?? process.env.BUS_NAME;

  const engine = new StreamEngine({
    serviceName: config.serviceName,
    filter: config.filter,
    groupBy: config.groupBy,
    processRecord: config.processRecord,
    processGroup: config.processGroup,
    concurrency: config.concurrency,
    busName,
    errorEventType: config.errorEventType,
  });

  return async (event: DynamoDBStreamEvent): Promise<void> => {
    return engine.process(event);
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test event-processor --testPathPattern=create-stream-handler`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add libs/event-processor/src/pipelines/create-stream-handler.ts libs/event-processor/test/pipelines/create-stream-handler.test.ts
git commit -m "feat: add createStreamHandler — universal DDB Stream factory"
```

---

### Task 7: EventBridgePublisher (internal CDC utility)

**Files:**
- Create: `libs/event-processor/src/util/event-bridge-publisher.ts`
- Create: `libs/event-processor/test/util/event-bridge-publisher.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// test/util/event-bridge-publisher.test.ts
import { EventBridgePublisher } from '../../src/util/event-bridge-publisher';
import { NotRetryableError } from '@nestfolio/lambda-utils';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  PutEventsCommand: jest.fn().mockImplementation((input) => input),
}));

describe('EventBridgePublisher', () => {
  let publisher: EventBridgePublisher;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({ FailedEntryCount: 0, Entries: [] });
    publisher = new EventBridgePublisher('test-bus', 'test-source');
  });

  it('publishes entries in batches of 10', async () => {
    const entries = Array.from({ length: 15 }, (_, i) => ({
      EventBusName: 'test-bus',
      Source: 'test-source',
      DetailType: `TYPE_${i}`,
      Detail: JSON.stringify({ i }),
    }));
    await publisher.publish(entries);
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls[0][0].Entries).toHaveLength(10);
    expect(mockSend.mock.calls[1][0].Entries).toHaveLength(5);
  });

  it('retries failed entries (retryable error codes)', async () => {
    mockSend
      .mockResolvedValueOnce({
        FailedEntryCount: 1,
        Entries: [
          { EventId: 'ok' },
          { ErrorCode: 'ThrottlingException', ErrorMessage: 'throttled' },
        ],
      })
      .mockResolvedValueOnce({ FailedEntryCount: 0, Entries: [{ EventId: 'ok2' }] });

    const entries = [
      { EventBusName: 'b', Source: 's', DetailType: 'T1', Detail: '{}' },
      { EventBusName: 'b', Source: 's', DetailType: 'T2', Detail: '{}' },
    ];
    await publisher.publish(entries);
    // First call: 2 entries. Second call: 1 retry entry.
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls[1][0].Entries).toHaveLength(1);
  });

  it('throws NotRetryableError on non-retryable error codes', async () => {
    mockSend.mockResolvedValue({
      FailedEntryCount: 1,
      Entries: [{ ErrorCode: 'ValidationException', ErrorMessage: 'bad' }],
    });
    const entries = [{ EventBusName: 'b', Source: 's', DetailType: 'T1', Detail: '{}' }];
    await expect(publisher.publish(entries)).rejects.toThrow(NotRetryableError);
  });

  it('throws after exhausting retries', async () => {
    const failResponse = {
      FailedEntryCount: 1,
      Entries: [{ ErrorCode: 'ThrottlingException', ErrorMessage: 'throttled' }],
    };
    mockSend.mockResolvedValue(failResponse);
    const entries = [{ EventBusName: 'b', Source: 's', DetailType: 'T1', Detail: '{}' }];
    // 1 initial + 2 retries = 3 total
    await expect(publisher.publish(entries)).rejects.toThrow('after 2 retries');
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  it('handles empty entries array', async () => {
    await publisher.publish([]);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test event-processor --testPathPattern=event-bridge-publisher`
Expected: FAIL

- [ ] **Step 3: Implement EventBridgePublisher**

```typescript
// src/util/event-bridge-publisher.ts
import { EventBridgeClient, PutEventsCommand, type PutEventsRequestEntry } from '@aws-sdk/client-eventbridge';
import { NotRetryableError } from '@nestfolio/lambda-utils';

const BATCH_SIZE = 10;
const MAX_RETRIES = 2;
const RETRYABLE_CODES = new Set(['ThrottlingException', 'InternalException']);

export class EventBridgePublisher {
  private readonly client: EventBridgeClient;

  constructor(
    private readonly busName: string,
    private readonly source: string,
    client?: EventBridgeClient,
  ) {
    this.client = client ?? new EventBridgeClient({});
  }

  async publish(entries: PutEventsRequestEntry[]): Promise<void> {
    if (entries.length === 0) return;

    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      let pending = entries.slice(i, i + BATCH_SIZE);

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const result = await this.client.send(new PutEventsCommand({ Entries: pending }));

        if (!result.FailedEntryCount || result.FailedEntryCount === 0) break;

        const resultEntries = result.Entries ?? [];
        const failed = resultEntries
          .map((entry, idx) => ({ ...entry, original: pending[idx] }))
          .filter((entry) => entry.ErrorCode);

        const hasNonRetryable = failed.some((e) => !RETRYABLE_CODES.has(e.ErrorCode!));
        if (hasNonRetryable) {
          throw new NotRetryableError(
            `Non-retryable EventBridge publish failure: ${failed.map((e) => e.ErrorCode).join(', ')}`,
          );
        }

        if (attempt < MAX_RETRIES) {
          pending = failed.map((e) => e.original);
          continue;
        }

        throw new Error(
          `Failed to publish ${result.FailedEntryCount} event(s) to EventBridge after ${MAX_RETRIES} retries`,
        );
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test event-processor --testPathPattern=event-bridge-publisher`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add libs/event-processor/src/util/event-bridge-publisher.ts libs/event-processor/test/util/event-bridge-publisher.test.ts
git commit -m "feat: add EventBridgePublisher — batch publish with retry for CDC"
```

---

### Task 8: changeDataCapture pipeline

**Files:**
- Create: `libs/event-processor/src/pipelines/change-data-capture.ts`
- Create: `libs/event-processor/test/pipelines/change-data-capture.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// test/pipelines/change-data-capture.test.ts
import { changeDataCapture } from '../../src/pipelines/change-data-capture';
import { fakeDdbStreamRecord } from '../../src/testing/fake-records';

const mockPublish = jest.fn().mockResolvedValue(undefined);
jest.mock('../../src/util/event-bridge-publisher', () => ({
  EventBridgePublisher: jest.fn().mockImplementation(() => ({
    publish: mockPublish,
  })),
}));

jest.mock('../../src/engine/error-event-publisher', () => ({
  ErrorEventPublisher: jest.fn().mockImplementation(() => ({
    publishErrors: jest.fn().mockResolvedValue(undefined),
  })),
}));

describe('changeDataCapture', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BUS_NAME = 'test-bus';
  });

  afterEach(() => {
    delete process.env.BUS_NAME;
  });

  it('publishes events matching eventTypeMap', async () => {
    const handler = changeDataCapture({
      serviceName: 'test',
      eventTypeMap: { 'Order:INSERT': 'ORDER_CREATED' },
    });
    await handler({
      Records: [
        fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'Order#1', __typename: 'Order', tenantId: 't1' }),
      ],
    });
    expect(mockPublish).toHaveBeenCalledTimes(1);
    const entries = mockPublish.mock.calls[0][0];
    expect(entries).toHaveLength(1);
    const detail = JSON.parse(entries[0].Detail);
    expect(detail.type).toBe('ORDER_CREATED');
    expect(detail.context.tenantId).toBe('t1');
  });

  it('skips records not in eventTypeMap', async () => {
    const handler = changeDataCapture({
      serviceName: 'test',
      eventTypeMap: { 'Order:INSERT': 'ORDER_CREATED' },
    });
    await handler({
      Records: [
        fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'Guard#1', __typename: 'Guard', tenantId: 't1' }),
      ],
    });
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('resolves event type from function', async () => {
    const handler = changeDataCapture({
      serviceName: 'test',
      eventTypeMap: {
        'Result:INSERT': (r) => (r.passed ? 'ENRICHED' : 'BLOCKED'),
      },
    });
    await handler({
      Records: [
        fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'Result#1', __typename: 'Result', tenantId: 't1', passed: true }),
      ],
    });
    const detail = JSON.parse(mockPublish.mock.calls[0][0][0].Detail);
    expect(detail.type).toBe('ENRICHED');
  });

  it('applies transform when provided', async () => {
    const handler = changeDataCapture({
      serviceName: 'test',
      eventTypeMap: { 'Order:INSERT': 'ORDER_CREATED' },
      transform: (r) => ({ orderId: r.sk, total: r.amount }),
    });
    await handler({
      Records: [
        fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'Order#1', __typename: 'Order', tenantId: 't1', amount: 500 }),
      ],
    });
    const detail = JSON.parse(mockPublish.mock.calls[0][0][0].Detail);
    expect(detail.subject).toEqual({ orderId: 'Order#1', total: 500 });
  });

  it('deduplicates with groupBy pick:last', async () => {
    const handler = changeDataCapture({
      serviceName: 'test',
      eventTypeMap: { 'Order:INSERT': 'ORDER_CREATED' },
      groupBy: { key: (r) => `${r.tenantId}#${r.sk}`, pick: 'last' },
    });
    await handler({
      Records: [
        fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'Order#1', __typename: 'Order', tenantId: 't1', v: 1 }),
        fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'Order#1', __typename: 'Order', tenantId: 't1', v: 2 }),
      ],
    });
    expect(mockPublish).toHaveBeenCalledTimes(1);
    const entries = mockPublish.mock.calls[0][0];
    expect(entries).toHaveLength(1);
    const detail = JSON.parse(entries[0].Detail);
    expect(detail.subject.v).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test event-processor --testPathPattern=change-data-capture`
Expected: FAIL

- [ ] **Step 3: Implement changeDataCapture**

```typescript
// src/pipelines/change-data-capture.ts
import type { DynamoDBStreamEvent } from 'aws-lambda';
import type { PutEventsRequestEntry } from '@aws-sdk/client-eventbridge';
import type { StreamRecord, StreamContext } from '../types/stream-types';
import { StreamEngine } from '../engine/stream-engine';
import { EventBridgePublisher } from '../util/event-bridge-publisher';
import { getUUID } from '@nestfolio/lambda-utils';

export interface ChangeDataCaptureConfig {
  serviceName: string;
  eventTypeMap: Record<string, string | ((record: StreamRecord) => string)>;
  groupBy?: {
    key: (record: StreamRecord) => string;
    pick?: 'first' | 'last';
  };
  bus?: string;
  concurrency?: number;
  transform?: (record: StreamRecord, eventType: string) => Record<string, unknown>;
}

function resolveEventType(
  record: StreamRecord,
  eventName: string,
  eventTypeMap: ChangeDataCaptureConfig['eventTypeMap'],
): string | null {
  const key = `${record.__typename}:${eventName}`;
  const resolver = eventTypeMap[key];
  if (!resolver) return null;
  return typeof resolver === 'function' ? resolver(record) : resolver;
}

function buildEntry(
  record: StreamRecord,
  ctx: StreamContext,
  eventType: string,
  busName: string,
  serviceName: string,
  transform?: ChangeDataCaptureConfig['transform'],
): PutEventsRequestEntry {
  const detail = {
    id: ctx.record.eventID ?? getUUID(),
    type: eventType,
    timestamp: new Date().toISOString(),
    subject: transform ? transform(record, eventType) : record,
    context: { tenantId: record.tenantId },
  };

  return {
    EventBusName: busName,
    Source: `${busName}@${serviceName}`,
    DetailType: eventType,
    Detail: JSON.stringify(detail),
  };
}

export function changeDataCapture(
  config: ChangeDataCaptureConfig,
): (event: DynamoDBStreamEvent) => Promise<void> {
  const busName = config.bus ?? process.env.BUS_NAME!;
  const publisher = new EventBridgePublisher(busName, `${busName}@${config.serviceName}`);

  // No filter on StreamEngine — eventTypeMap matching happens inside processRecord/processGroup
  // (StreamEngine filter only receives StreamRecord, but we need eventName for type map lookup)

  // Per-record processing (no groupBy)
  const processRecord = async (record: StreamRecord, ctx: StreamContext): Promise<void> => {
    const eventType = resolveEventType(record, record.eventName, config.eventTypeMap);
    if (!eventType) return;

    const entry = buildEntry(record, ctx, eventType, busName, config.serviceName, config.transform);
    await publisher.publish([entry]);
  };

  // Per-group processing (with groupBy)
  const processGroup = async (groupKey: string, records: StreamRecord[], ctx: StreamContext): Promise<void> => {
    const entries: PutEventsRequestEntry[] = [];
    for (const record of records) {
      // Use per-record eventName (from StreamRecord), NOT ctx.eventName (from first record in group)
      const eventType = resolveEventType(record, record.eventName, config.eventTypeMap);
      if (!eventType) continue;
      entries.push(buildEntry(record, ctx, eventType, busName, config.serviceName, config.transform));
    }
    if (entries.length > 0) {
      await publisher.publish(entries);
    }
  };

  if (config.groupBy) {
    const engine = new StreamEngine({
      serviceName: config.serviceName,
      groupBy: config.groupBy,
      processGroup,
      concurrency: config.concurrency,
      busName,
    });
    return (event: DynamoDBStreamEvent) => engine.process(event);
  }

  const engine = new StreamEngine({
    serviceName: config.serviceName,
    processRecord,
    concurrency: config.concurrency,
    busName,
  });
  return (event: DynamoDBStreamEvent) => engine.process(event);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test event-processor --testPathPattern=change-data-capture`
Expected: PASS (5 tests)

- [ ] **Step 5: Run ALL tests**

Run: `npx nx test event-processor`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add libs/event-processor/src/pipelines/change-data-capture.ts libs/event-processor/test/pipelines/change-data-capture.test.ts
git commit -m "feat: add changeDataCapture pipeline — DDB Stream to EventBridge"
```

---

## Chunk 4: replayAndReduce Pipeline

### Task 9: replayAndReduce

**Files:**
- Create: `libs/event-processor/src/pipelines/replay-and-reduce.ts`
- Create: `libs/event-processor/test/pipelines/replay-and-reduce.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// test/pipelines/replay-and-reduce.test.ts
import { replayAndReduce, type ReplayAndReduceConfig } from '../../src/pipelines/replay-and-reduce';
import { fakeDdbStreamRecord } from '../../src/testing/fake-records';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockImplementation(() => ({ send: mockSend })),
  },
  GetCommand: jest.fn().mockImplementation((input) => ({ ...input, _cmd: 'Get' })),
  PutCommand: jest.fn().mockImplementation((input) => ({ ...input, _cmd: 'Put' })),
  QueryCommand: jest.fn().mockImplementation((input) => ({ ...input, _cmd: 'Query' })),
}));
jest.mock('../../src/engine/error-event-publisher', () => ({
  ErrorEventPublisher: jest.fn().mockImplementation(() => ({
    publishErrors: jest.fn().mockResolvedValue(undefined),
  })),
}));

interface TestState { total: number }

const testConfig: ReplayAndReduceConfig<TestState> = {
  serviceName: 'test-service',
  filter: (r) => r.__typename === 'Event',
  groupBy: { key: (r) => `${r.tenantId}#stream` },
  reducer: (state, event) => ({ total: state.total + ((event.amount as number) ?? 0) }),
  initialState: { total: 0 },
  snapshot: {
    key: (gk) => {
      const [tenantId] = gk.split('#');
      return { pk: `T#${tenantId}`, sk: 'Snapshot#current' };
    },
  },
};

describe('replayAndReduce', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TABLE_NAME = 'test-table';
  });

  afterEach(() => {
    delete process.env.TABLE_NAME;
  });

  it('returns a handler function', () => {
    const handler = replayAndReduce(testConfig);
    expect(typeof handler).toBe('function');
  });

  it('loads snapshot, queries events, reduces, and saves', async () => {
    // GetCommand: no existing snapshot
    mockSend.mockResolvedValueOnce({ Item: undefined });
    // QueryCommand: returns events
    mockSend.mockResolvedValueOnce({
      Items: [
        { eventType: 'ADD', amount: 100, sequenceNo: 1 },
        { eventType: 'ADD', amount: 200, sequenceNo: 2 },
      ],
    });
    // PutCommand: save snapshot (success)
    mockSend.mockResolvedValueOnce({});

    const handler = replayAndReduce(testConfig);
    await handler({
      Records: [
        fakeDdbStreamRecord('INSERT', {
          pk: 'T#t1', sk: 'Event#1', __typename: 'Event', tenantId: 't1', sequenceNo: 1,
        }),
      ],
    });

    // Verify snapshot save
    const putCall = mockSend.mock.calls[2][0];
    expect(putCall.Item.total).toBe(300);
    expect(putCall.Item.version).toBe(1);
    expect(putCall.Item.lastEventSequence).toBe(2);
  });

  it('applies delta on existing snapshot', async () => {
    // GetCommand: existing snapshot
    mockSend.mockResolvedValueOnce({
      Item: { total: 500, version: 3, lastEventSequence: 10 },
    });
    // QueryCommand: new events since seq 10
    mockSend.mockResolvedValueOnce({
      Items: [{ eventType: 'ADD', amount: 50, sequenceNo: 11 }],
    });
    // PutCommand: save
    mockSend.mockResolvedValueOnce({});

    const handler = replayAndReduce(testConfig);
    await handler({
      Records: [
        fakeDdbStreamRecord('INSERT', {
          pk: 'T#t1', sk: 'Event#11', __typename: 'Event', tenantId: 't1', sequenceNo: 11,
        }),
      ],
    });

    const putCall = mockSend.mock.calls[2][0];
    expect(putCall.Item.total).toBe(550);
    expect(putCall.Item.version).toBe(4);
  });

  it('skips when no new events from query', async () => {
    mockSend.mockResolvedValueOnce({ Item: { total: 500, version: 3, lastEventSequence: 10 } });
    mockSend.mockResolvedValueOnce({ Items: [] });

    const handler = replayAndReduce(testConfig);
    await handler({
      Records: [
        fakeDdbStreamRecord('INSERT', {
          pk: 'T#t1', sk: 'Event#10', __typename: 'Event', tenantId: 't1', sequenceNo: 10,
        }),
      ],
    });

    // Only 2 calls (Get + Query), no Put
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('retries on ConditionalCheckFailedException', async () => {
    mockSend.mockResolvedValueOnce({ Item: { total: 0, version: 1, lastEventSequence: 0 } });
    mockSend.mockResolvedValueOnce({ Items: [{ amount: 100, sequenceNo: 1 }] });
    // PutCommand fails with conditional check
    const condError = new Error('ConditionalCheckFailedException');
    condError.name = 'ConditionalCheckFailedException';
    mockSend.mockRejectedValueOnce(condError);

    const handler = replayAndReduce(testConfig);
    // Should throw (retryable) so DDB Stream retries the batch
    await expect(handler({
      Records: [
        fakeDdbStreamRecord('INSERT', {
          pk: 'T#t1', sk: 'Event#1', __typename: 'Event', tenantId: 't1', sequenceNo: 1,
        }),
      ],
    })).rejects.toThrow('StreamBatchError');
  });

  it('filters non-matching records', async () => {
    const handler = replayAndReduce(testConfig);
    await handler({
      Records: [
        fakeDdbStreamRecord('INSERT', {
          pk: 'T#t1', sk: 'Guard#1', __typename: 'Guard', tenantId: 't1',
        }),
      ],
    });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('uses queryEvents override when provided', async () => {
    const customQuery = jest.fn().mockResolvedValue([{ amount: 999, sequenceNo: 1 }]);
    const configWithOverride = { ...testConfig, queryEvents: customQuery };

    mockSend.mockResolvedValueOnce({ Item: undefined }); // Get snapshot
    mockSend.mockResolvedValueOnce({}); // Put snapshot

    const handler = replayAndReduce(configWithOverride);
    await handler({
      Records: [
        fakeDdbStreamRecord('INSERT', {
          pk: 'T#t1', sk: 'Event#1', __typename: 'Event', tenantId: 't1', sequenceNo: 1,
        }),
      ],
    });

    expect(customQuery).toHaveBeenCalledWith('t1#stream', 0, expect.objectContaining({ tableName: 'test-table' }));
    const putCall = mockSend.mock.calls[1][0];
    expect(putCall.Item.total).toBe(999);
  });

  it('saves daily checkpoint when configured', async () => {
    const configWithDaily = { ...testConfig, snapshot: { ...testConfig.snapshot, daily: true } };

    mockSend.mockResolvedValueOnce({ Item: undefined }); // Get snapshot
    mockSend.mockResolvedValueOnce({ Items: [{ amount: 100, sequenceNo: 1 }] }); // Query
    mockSend.mockResolvedValueOnce({}); // Put snapshot
    mockSend.mockResolvedValueOnce({}); // Put daily checkpoint

    const handler = replayAndReduce(configWithDaily);
    await handler({
      Records: [
        fakeDdbStreamRecord('INSERT', {
          pk: 'T#t1', sk: 'Event#1', __typename: 'Event', tenantId: 't1', sequenceNo: 1,
        }),
      ],
    });

    expect(mockSend).toHaveBeenCalledTimes(4);
    const dailyPut = mockSend.mock.calls[3][0];
    const today = new Date().toISOString().slice(0, 10);
    expect(dailyPut.Item.sk).toBe(`Snapshot#${today}`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test event-processor --testPathPattern=replay-and-reduce`
Expected: FAIL

- [ ] **Step 3: Implement replayAndReduce**

```typescript
// src/pipelines/replay-and-reduce.ts
import type { DynamoDBStreamEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '@nestfolio/lambda-utils';
import type { StreamRecord, StreamContext } from '../types/stream-types';
import { StreamEngine } from '../engine/stream-engine';

export interface ReplayAndReduceConfig<S> {
  serviceName: string;
  filter?: (record: StreamRecord) => boolean;
  groupBy: {
    key: (record: StreamRecord) => string;
  };
  reducer: (state: S, event: Record<string, unknown>) => S;
  initialState: S | (() => S);
  snapshot: {
    key: (groupKey: string) => { pk: string; sk: string };
    daily?: boolean;
  };
  queryEvents?: (
    groupKey: string,
    lastSequence: number,
    clients: { docClient: DynamoDBDocumentClient; tableName: string },
  ) => Promise<Record<string, unknown>[]>;
  table?: string;
  bus?: string;
  concurrency?: number;
}

async function conventionQuery(
  lastSequence: number,
  typename: string,
  pk: string,
  clients: { docClient: DynamoDBDocumentClient; tableName: string },
): Promise<Record<string, unknown>[]> {
  const result = await clients.docClient.send(new QueryCommand({
    TableName: clients.tableName,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
    FilterExpression: 'sequenceNo > :seq',
    ExpressionAttributeValues: {
      ':pk': pk,
      ':prefix': `${typename}#`,
      ':seq': lastSequence,
    },
    ScanIndexForward: true,
  }));
  return (result.Items ?? []) as Record<string, unknown>[];
}

export function replayAndReduce<S>(
  config: ReplayAndReduceConfig<S>,
): (event: DynamoDBStreamEvent) => Promise<void> {
  const tableName = config.table ?? process.env.TABLE_NAME!;
  const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const clients = { docClient, tableName };

  const processGroup = async (
    groupKey: string,
    records: StreamRecord[],
    _ctx: StreamContext,
  ): Promise<void> => {
    const snapshotKey = config.snapshot.key(groupKey);

    // 1. Load current snapshot
    const snapshotResult = await docClient.send(new GetCommand({
      TableName: tableName,
      Key: snapshotKey,
    }));

    const existing = snapshotResult.Item;
    const currentState: S = existing
      ? (existing as unknown as S)
      : (typeof config.initialState === 'function'
        ? (config.initialState as () => S)()
        : config.initialState);
    const lastSeq = (existing?.lastEventSequence as number) ?? 0;
    const currentVersion = (existing?.version as number) ?? 0;

    // 2. Query events since checkpoint
    let events: Record<string, unknown>[];
    if (config.queryEvents) {
      events = await config.queryEvents(groupKey, lastSeq, clients);
    } else {
      // Convention query: use typename and pk from first record in group
      const firstRecord = records[0];
      events = await conventionQuery(lastSeq, firstRecord.__typename, firstRecord.pk, clients);
    }

    if (events.length === 0) {
      logger.info('No new events to reduce', { groupKey });
      return;
    }

    // 3. Sort by sequenceNo (defensive)
    events.sort((a, b) => ((a.sequenceNo as number) ?? 0) - ((b.sequenceNo as number) ?? 0));

    // 4. Reduce
    const nextState = events.reduce(
      (state, event) => config.reducer(state, event),
      currentState,
    );

    // 5. Save snapshot with optimistic concurrency
    const maxSeq = events.reduce(
      (max, e) => Math.max(max, (e.sequenceNo as number) ?? 0),
      0,
    );
    const nextVersion = currentVersion + 1;

    try {
      await docClient.send(new PutCommand({
        TableName: tableName,
        Item: {
          ...snapshotKey,
          ...(nextState as Record<string, unknown>),
          version: nextVersion,
          lastEventSequence: maxSeq,
          updatedAt: new Date().toISOString(),
        },
        ConditionExpression: 'attribute_not_exists(pk) OR version = :v',
        ExpressionAttributeValues: { ':v': currentVersion },
      }));
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'ConditionalCheckFailedException') {
        // Optimistic concurrency conflict — rethrow as a plain Error (retryable)
        // Note: isRetryable() classifies ConditionalCheckFailedException as non-retryable
        // (AWS SDK client fault), so we must throw a plain Error to trigger stream batch retry
        throw new Error(`Snapshot conflict for ${groupKey} — concurrent update detected`);
      }
      throw err;
    }

    // 6. Daily checkpoint
    if (config.snapshot.daily) {
      const today = new Date().toISOString().slice(0, 10);
      try {
        await docClient.send(new PutCommand({
          TableName: tableName,
          Item: {
            pk: snapshotKey.pk,
            sk: `Snapshot#${today}`,
            ...(nextState as Record<string, unknown>),
            version: nextVersion,
            lastEventSequence: maxSeq,
            createdAt: new Date().toISOString(),
          },
          ConditionExpression: 'attribute_not_exists(pk)',
        }));
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'ConditionalCheckFailedException') {
          logger.info('Daily checkpoint already exists', { groupKey, today });
        } else {
          throw err;
        }
      }
    }

    logger.info('Snapshot updated', { groupKey, version: nextVersion, eventCount: events.length });
  };

  const busName = config.bus ?? process.env.BUS_NAME;

  const engine = new StreamEngine({
    serviceName: config.serviceName,
    filter: config.filter,
    groupBy: { key: config.groupBy.key },
    processGroup,
    concurrency: config.concurrency,
    busName,
  });

  return (event: DynamoDBStreamEvent) => engine.process(event);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test event-processor --testPathPattern=replay-and-reduce`
Expected: PASS (8 tests)

- [ ] **Step 5: Run ALL tests**

Run: `npx nx test event-processor`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add libs/event-processor/src/pipelines/replay-and-reduce.ts libs/event-processor/test/pipelines/replay-and-reduce.test.ts
git commit -m "feat: add replayAndReduce pipeline — event sourcing with query-since-checkpoint"
```

---

## Chunk 5: materializeToBucket, Testing Harnesses, Exports

### Task 10: materializeToBucket (SQS preset)

**Files:**
- Create: `libs/event-processor/src/pipelines/materialize-to-bucket.ts`
- Create: `libs/event-processor/test/pipelines/materialize-to-bucket.test.ts`
- Modify: `libs/event-processor/src/types/write-intent.ts` (make S3PutIntent.format optional)
- Modify: `libs/event-processor/src/pipelines/create-event-handler.ts` (add `s3` field to EventHandlerConfig)

- [ ] **Step 1a: Add `s3` field to EventHandlerConfig**

In `src/pipelines/create-event-handler.ts`, add to `EventHandlerConfig`:
```typescript
export interface EventHandlerConfig {
  serviceName: string;
  handlers: Record<string, HandlerEntry>;
  table?: string | { name: string; client: DynamoDBDocumentClient };
  bus?: string;
  s3?: { bucket: string };         // NEW — for materializeToBucket
  concurrency?: number;
  poisonPill?: { maxReceiveCount: number };
  errorEventType?: string;
}
```

The `s3.bucket` value is passed to `IntentExecutor` (which needs a corresponding update to accept and use an S3 client + bucket for `s3-put` intents). For now, store bucket name in `BatchEngineConfig` and pass to `IntentExecutor`. The `IntentExecutor.execute()` for `s3-put` currently throws `NotRetryableError` — update it to create an S3 client and perform the PutObject.

- [ ] **Step 1b: Make S3PutIntent.format optional**

In `src/types/write-intent.ts`, change line 32:
```typescript
readonly format: 'json' | 'csv';
```
To:
```typescript
readonly format?: 'json' | 'csv';
```

- [ ] **Step 2: Write failing tests**

```typescript
// test/pipelines/materialize-to-bucket.test.ts
import { materializeToBucket } from '../../src/pipelines/materialize-to-bucket';
import { s3Put } from '../../src/intents/s3-put';

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn().mockImplementation(() => ({ send: jest.fn() })) },
}));

describe('materializeToBucket', () => {
  beforeEach(() => {
    process.env.EXPORT_BUCKET = 'test-bucket';
    process.env.TABLE_NAME = 'test-table';
  });

  afterEach(() => {
    delete process.env.EXPORT_BUCKET;
    delete process.env.TABLE_NAME;
  });

  it('returns a handler function', () => {
    const handler = materializeToBucket({
      serviceName: 'test',
      handlers: { TEST: async () => [s3Put({ data: 1 })] },
    });
    expect(typeof handler).toBe('function');
  });

  it('uses EXPORT_BUCKET env var by default', () => {
    // Verifies it doesn't throw during construction
    const handler = materializeToBucket({
      serviceName: 'test',
      handlers: {},
    });
    expect(handler).toBeDefined();
  });

  it('accepts custom bucket name', () => {
    const handler = materializeToBucket({
      serviceName: 'test',
      handlers: {},
      bucket: 'custom-bucket',
    });
    expect(handler).toBeDefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx nx test event-processor --testPathPattern=materialize-to-bucket`
Expected: FAIL

- [ ] **Step 4: Implement materializeToBucket**

```typescript
// src/pipelines/materialize-to-bucket.ts
import type { SQSEvent, SQSBatchResponse, Context } from 'aws-lambda';
import { createEventHandler, type EventHandlerConfig } from './create-event-handler';
import type { HandlerEntry } from '../types/handler-config';

export interface MaterializeToBucketConfig {
  serviceName: string;
  handlers: Record<string, HandlerEntry>;
  bucket?: string;
  bus?: string;
  concurrency?: number;
  poisonPill?: { maxReceiveCount: number };
  defaultFormat?: 'json' | 'csv';
}

export function materializeToBucket(
  config: MaterializeToBucketConfig,
): (event: SQSEvent, context?: Context) => Promise<SQSBatchResponse> {
  return createEventHandler({
    serviceName: config.serviceName,
    handlers: config.handlers,
    bus: config.bus,
    concurrency: config.concurrency,
    poisonPill: config.poisonPill,
    s3: { bucket: config.bucket ?? process.env.EXPORT_BUCKET! },
  } as EventHandlerConfig);
}
```

Note: The `createEventHandler` config may need an `s3` field added. If `EventHandlerConfig` doesn't have `s3` yet, add it:
```typescript
// In create-event-handler.ts, add to EventHandlerConfig:
s3?: { bucket: string };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx nx test event-processor --testPathPattern=materialize-to-bucket`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add libs/event-processor/src/pipelines/materialize-to-bucket.ts libs/event-processor/test/pipelines/materialize-to-bucket.test.ts libs/event-processor/src/types/write-intent.ts libs/event-processor/src/pipelines/create-event-handler.ts
git commit -m "feat: add materializeToBucket SQS preset, make S3PutIntent.format optional"
```

---

### Task 11: Enhance fakeDdbStreamRecord

**Files:**
- Modify: `libs/event-processor/src/testing/fake-records.ts`
- Modify: `libs/event-processor/test/testing/test-harness.test.ts` (or create new test)

- [ ] **Step 1: Update fakeDdbStreamRecord with convenience opts**

In `src/testing/fake-records.ts`, modify the `fakeDdbStreamRecord` function signature and body to accept `typename`, `tenantId`, and `sequenceNo` opts that auto-set fields on `newImage`:

```typescript
export function fakeDdbStreamRecord(
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE',
  newImage: Record<string, unknown>,
  opts?: {
    oldImage?: Record<string, unknown>;
    typename?: string;
    tenantId?: string;
    sequenceNo?: number;
  },
): DynamoDBRecord {
  const image = { ...newImage };
  if (opts?.typename && !image.__typename) image.__typename = opts.typename;
  if (opts?.tenantId && !image.tenantId) image.tenantId = opts.tenantId;
  if (opts?.sequenceNo != null && image.sequenceNo == null) image.sequenceNo = opts.sequenceNo;
  // Auto-set pk/sk if not provided
  if (!image.pk) image.pk = `T#${image.tenantId ?? 'test-tenant'}`;
  if (!image.sk) image.sk = `${image.__typename ?? 'Unknown'}#${randomUUID()}`;

  return {
    eventID: randomUUID(),
    eventName,
    eventVersion: '1.1',
    eventSource: 'aws:dynamodb',
    awsRegion: 'us-east-1',
    dynamodb: {
      Keys: {
        pk: { S: image.pk as string },
        sk: { S: image.sk as string },
      },
      NewImage: eventName !== 'REMOVE' ? toAttributeMap(image) : undefined,
      OldImage: opts?.oldImage ? toAttributeMap(opts.oldImage) : (eventName === 'REMOVE' ? toAttributeMap(image) : undefined),
      StreamViewType: 'NEW_AND_OLD_IMAGES',
      SequenceNumber: '1',
      SizeBytes: 100,
    },
    eventSourceARN: 'arn:aws:dynamodb:us-east-1:000000000000:table/test/stream/2026-01-01',
  };
}
```

- [ ] **Step 2: Run ALL tests to verify no regression**

Run: `npx nx test event-processor`
Expected: ALL PASS (existing tests that use fakeDdbStreamRecord should still work since opts are optional)

- [ ] **Step 3: Commit**

```bash
git add libs/event-processor/src/testing/fake-records.ts
git commit -m "feat: enhance fakeDdbStreamRecord with typename/tenantId/sequenceNo convenience opts"
```

---

### Task 12: Stream test harnesses

**Files:**
- Modify: `libs/event-processor/src/testing/test-harness.ts`
- Create: `libs/event-processor/test/testing/stream-test-harness.test.ts`

- [ ] **Step 1: Write failing tests for stream harnesses**

```typescript
// test/testing/stream-test-harness.test.ts
import { createStreamTestHarness, createCdcTestHarness, createReducerTestHarness } from '../../src/testing/test-harness';
import { fakeDdbStreamRecord } from '../../src/testing/fake-records';

describe('createStreamTestHarness', () => {
  it('processes records through processRecord', async () => {
    const processRecord = jest.fn().mockResolvedValue(undefined);
    const harness = createStreamTestHarness({
      serviceName: 'test',
      processRecord,
    });
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'A#1', __typename: 'A', tenantId: 't1' }),
    ]);
    expect(result.processed).toBe(1);
    expect(result.thrown).toBe(false);
  });

  it('collects errors and sets thrown flag', async () => {
    const harness = createStreamTestHarness({
      serviceName: 'test',
      processRecord: jest.fn().mockRejectedValue(new Error('fail')),
    });
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'A#1', __typename: 'A', tenantId: 't1' }),
    ]);
    expect(result.errors).toHaveLength(1);
    expect(result.thrown).toBe(true);
  });

  it('applies filter', async () => {
    const processRecord = jest.fn().mockResolvedValue(undefined);
    const harness = createStreamTestHarness({
      serviceName: 'test',
      filter: (r) => r.__typename === 'Order',
      processRecord,
    });
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'O#1', __typename: 'Order', tenantId: 't1' }),
      fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'G#1', __typename: 'Guard', tenantId: 't1' }),
    ]);
    expect(result.processed).toBe(1);
    expect(result.filtered).toBe(1);
  });
});

describe('createCdcTestHarness', () => {
  it('captures published events', async () => {
    const harness = createCdcTestHarness({
      serviceName: 'test',
      eventTypeMap: { 'Order:INSERT': 'ORDER_CREATED' },
    });
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'Order#1', __typename: 'Order', tenantId: 't1' }),
    ]);
    expect(result.publishedEvents).toHaveLength(1);
    expect(result.publishedEvents[0].eventType).toBe('ORDER_CREATED');
  });

  it('captures no events for unmatched types', async () => {
    const harness = createCdcTestHarness({
      serviceName: 'test',
      eventTypeMap: { 'Order:INSERT': 'ORDER_CREATED' },
    });
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'Guard#1', __typename: 'Guard', tenantId: 't1' }),
    ]);
    expect(result.publishedEvents).toHaveLength(0);
  });
});

describe('createReducerTestHarness', () => {
  const reducer = (state: { total: number }, event: Record<string, unknown>) => ({
    total: state.total + ((event.amount as number) ?? 0),
  });

  it('reduces from initial state', async () => {
    const harness = createReducerTestHarness({
      serviceName: 'test',
      filter: (r) => r.__typename === 'Event',
      groupBy: { key: (r) => r.tenantId },
      reducer,
      initialState: { total: 0 },
      snapshot: { key: (gk) => ({ pk: `T#${gk}`, sk: 'Snapshot#current' }) },
    });
    harness.seedEvents('t1', [{ amount: 100, sequenceNo: 1 }, { amount: 200, sequenceNo: 2 }]);
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'Event', tenantId: 't1', sequenceNo: 1 }),
    ]);
    expect(result.snapshots.get('t1')?.state).toEqual({ total: 300 });
    expect(result.snapshots.get('t1')?.version).toBe(1);
  });

  it('reduces from seeded snapshot', async () => {
    const harness = createReducerTestHarness({
      serviceName: 'test',
      filter: (r) => r.__typename === 'Event',
      groupBy: { key: (r) => r.tenantId },
      reducer,
      initialState: { total: 0 },
      snapshot: { key: (gk) => ({ pk: `T#${gk}`, sk: 'Snapshot#current' }) },
    });
    harness.seedSnapshot('t1', { total: 500 }, 3, 10);
    harness.seedEvents('t1', [{ amount: 50, sequenceNo: 11 }]);
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'Event', tenantId: 't1', sequenceNo: 11 }),
    ]);
    expect(result.snapshots.get('t1')?.state).toEqual({ total: 550 });
    expect(result.snapshots.get('t1')?.version).toBe(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test event-processor --testPathPattern=stream-test-harness`
Expected: FAIL

- [ ] **Step 3: Implement stream test harnesses**

Add to `src/testing/test-harness.ts`:

```typescript
// --- Stream Test Harnesses ---
import type { DynamoDBRecord } from 'aws-lambda';
import type { StreamRecord, StreamContext } from '../types/stream-types';
import { unmarshalStream } from '../util/unmarshal-stream';
import { isRetryable } from '@nestfolio/lambda-utils';
import { groupBy as groupByUtil } from '../util/group-by';

export interface StreamTestResult {
  processed: number;
  filtered: number;
  errors: Array<{ groupKey?: string; error: Error; retryable: boolean }>;
  thrown: boolean;
  metrics: Record<string, number>;
}

export interface CdcTestResult extends StreamTestResult {
  publishedEvents: Array<{
    eventType: string;
    subject: Record<string, unknown>;
    context: Record<string, unknown>;
  }>;
}

export interface ReducerTestResult<S> extends StreamTestResult {
  snapshots: Map<string, { state: S; version: number; lastEventSequence: number }>;
  dailyCheckpoints: Map<string, S>;
  queriedGroups: string[];
}

// Stream config type (subset of StreamHandlerConfig without bus/table)
interface StreamTestConfig {
  serviceName: string;
  processRecord?: (record: StreamRecord, ctx: StreamContext) => Promise<void>;
  processGroup?: (groupKey: string, records: StreamRecord[], ctx: StreamContext) => Promise<void>;
  groupBy?: { key: (record: StreamRecord) => string; pick?: 'first' | 'last' | 'all' };
  filter?: (record: StreamRecord) => boolean;
}

export function createStreamTestHarness(config: StreamTestConfig) {
  return {
    async process(records: DynamoDBRecord[]): Promise<StreamTestResult> {
      let processed = 0;
      let filtered = 0;
      const errors: StreamTestResult['errors'] = [];

      const parsed = records
        .map((r) => unmarshalStream(r, config.serviceName))
        .filter((r): r is NonNullable<typeof r> => r !== null);

      const afterFilter = config.filter
        ? parsed.filter((p) => {
            const pass = config.filter!(p.streamRecord);
            if (!pass) filtered++;
            return pass;
          })
        : parsed;

      if (config.groupBy && config.processGroup) {
        const groups = groupByUtil(afterFilter, {
          key: (p) => config.groupBy!.key(p.streamRecord),
          pick: config.groupBy.pick ?? 'all',
        });

        for (const [groupKey, items] of groups.entries()) {
          const recs = Array.isArray(items) ? items : [items];
          try {
            await config.processGroup(groupKey, recs.map((r) => r.streamRecord), recs[0].ctx);
            processed++;
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            errors.push({ groupKey, error: err, retryable: isRetryable(err) });
          }
        }
      } else if (config.processRecord) {
        for (const { streamRecord, ctx } of afterFilter) {
          try {
            await config.processRecord(streamRecord, ctx);
            processed++;
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            errors.push({ error: err, retryable: isRetryable(err) });
          }
        }
      }

      const thrown = errors.some((e) => e.retryable);

      return { processed, filtered, errors, thrown, metrics: {} };
    },
  };
}

export function createCdcTestHarness(config: {
  serviceName: string;
  eventTypeMap: Record<string, string | ((record: StreamRecord) => string)>;
  groupBy?: { key: (record: StreamRecord) => string; pick?: 'first' | 'last' };
  transform?: (record: StreamRecord, eventType: string) => Record<string, unknown>;
}) {
  return {
    async process(records: DynamoDBRecord[]): Promise<CdcTestResult> {
      const publishedEvents: CdcTestResult['publishedEvents'] = [];
      let processed = 0;
      let filtered = 0;
      const errors: StreamTestResult['errors'] = [];

      const parsed = records
        .map((r) => unmarshalStream(r, config.serviceName))
        .filter((r): r is NonNullable<typeof r> => r !== null);

      // Group or process individually
      const items = config.groupBy
        ? (() => {
            const groups = groupByUtil(parsed, {
              key: (p) => config.groupBy!.key(p.streamRecord),
              pick: config.groupBy.pick ?? 'last',
            });
            return Array.from(groups.values()).map((v) => (Array.isArray(v) ? v[v.length - 1] : v));
          })()
        : parsed;

      for (const { streamRecord, ctx } of items) {
        const key = `${streamRecord.__typename}:${ctx.eventName}`;
        const resolver = config.eventTypeMap[key];
        if (!resolver) continue;

        const eventType = typeof resolver === 'function' ? resolver(streamRecord) : resolver;
        const subject = config.transform ? config.transform(streamRecord, eventType) : (streamRecord as unknown as Record<string, unknown>);

        publishedEvents.push({
          eventType,
          subject,
          context: { tenantId: streamRecord.tenantId },
        });
        processed++;
      }

      return { processed, filtered, errors, thrown: false, metrics: {}, publishedEvents };
    },
  };
}

export function createReducerTestHarness<S>(config: {
  serviceName: string;
  filter?: (record: StreamRecord) => boolean;
  groupBy: { key: (record: StreamRecord) => string };
  reducer: (state: S, event: Record<string, unknown>) => S;
  initialState: S | (() => S);
  snapshot: { key: (groupKey: string) => { pk: string; sk: string }; daily?: boolean };
}) {
  const seededSnapshots = new Map<string, { state: S; version: number; lastSeq: number }>();
  const seededEvents = new Map<string, Record<string, unknown>[]>();

  return {
    seedSnapshot(groupKey: string, state: S, version: number, lastSeq: number): void {
      seededSnapshots.set(groupKey, { state, version, lastSeq });
    },

    seedEvents(groupKey: string, events: Record<string, unknown>[]): void {
      seededEvents.set(groupKey, events);
    },

    async process(records: DynamoDBRecord[]): Promise<ReducerTestResult<S>> {
      const snapshots = new Map<string, { state: S; version: number; lastEventSequence: number }>();
      const dailyCheckpoints = new Map<string, S>();
      const queriedGroups: string[] = [];
      let processed = 0;
      let filtered = 0;
      const errors: StreamTestResult['errors'] = [];

      const parsed = records
        .map((r) => unmarshalStream(r, config.serviceName))
        .filter((r): r is NonNullable<typeof r> => r !== null);

      const afterFilter = config.filter
        ? parsed.filter((p) => {
            const pass = config.filter!(p.streamRecord);
            if (!pass) filtered++;
            return pass;
          })
        : parsed;

      if (afterFilter.length === 0) {
        return { processed, filtered, errors, thrown: false, metrics: {}, snapshots, dailyCheckpoints, queriedGroups };
      }

      const groups = groupByUtil(afterFilter, { key: (p) => config.groupBy.key(p.streamRecord) });

      for (const [groupKey] of groups.entries()) {
        try {
          queriedGroups.push(groupKey);
          const seeded = seededSnapshots.get(groupKey);
          const currentState = seeded?.state
            ?? (typeof config.initialState === 'function' ? (config.initialState as () => S)() : config.initialState);
          const lastSeq = seeded?.lastSeq ?? 0;
          const currentVersion = seeded?.version ?? 0;

          const events = seededEvents.get(groupKey) ?? [];
          const sorted = [...events].sort((a, b) => ((a.sequenceNo as number) ?? 0) - ((b.sequenceNo as number) ?? 0));

          const nextState = sorted.reduce((s, e) => config.reducer(s, e), currentState);
          const maxSeq = sorted.reduce((max, e) => Math.max(max, (e.sequenceNo as number) ?? 0), lastSeq);

          snapshots.set(groupKey, {
            state: nextState,
            version: currentVersion + 1,
            lastEventSequence: maxSeq,
          });

          if (config.snapshot.daily) {
            const today = new Date().toISOString().slice(0, 10);
            dailyCheckpoints.set(`${groupKey}#${today}`, nextState);
          }

          processed++;
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          errors.push({ groupKey, error: err, retryable: true });
        }
      }

      const thrown = errors.some((e) => e.retryable);
      return { processed, filtered, errors, thrown, metrics: {}, snapshots, dailyCheckpoints, queriedGroups };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test event-processor --testPathPattern=stream-test-harness`
Expected: PASS (7 tests)

- [ ] **Step 5: Run ALL tests**

Run: `npx nx test event-processor`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add libs/event-processor/src/testing/test-harness.ts libs/event-processor/test/testing/stream-test-harness.test.ts
git commit -m "feat: add stream test harnesses (createStreamTestHarness, createCdcTestHarness, createReducerTestHarness)"
```

---

### Task 13: Update index.ts exports

**Files:**
- Modify: `libs/event-processor/src/index.ts`

- [ ] **Step 1: Add all new exports to index.ts**

Add after the existing exports:

```typescript
// DDB Stream Pipelines
export { createStreamHandler } from './pipelines/create-stream-handler';
export type { StreamHandlerConfig } from './pipelines/create-stream-handler';
export { changeDataCapture } from './pipelines/change-data-capture';
export type { ChangeDataCaptureConfig } from './pipelines/change-data-capture';
export { replayAndReduce } from './pipelines/replay-and-reduce';
export type { ReplayAndReduceConfig } from './pipelines/replay-and-reduce';

// SQS Presets (deferred)
export { materializeToBucket } from './pipelines/materialize-to-bucket';
export type { MaterializeToBucketConfig } from './pipelines/materialize-to-bucket';

// Stream Engine (advanced)
export { StreamEngine, StreamBatchError } from './engine/stream-engine';
export { StreamCollector } from './engine/stream-collector';
export { BaseCollector } from './engine/base-collector';
export type { CollectedError } from './engine/base-collector';

// Stream Testing
export { createStreamTestHarness, createCdcTestHarness, createReducerTestHarness } from './testing/test-harness';
export type { StreamTestResult, CdcTestResult, ReducerTestResult } from './testing/test-harness';
```

- [ ] **Step 2: Run ALL tests**

Run: `npx nx test event-processor`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add libs/event-processor/src/index.ts
git commit -m "feat: export DDB Stream pipelines, materializeToBucket, and stream testing harnesses"
```

---

### Task 14: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npx nx test event-processor --verbose`
Expected: ALL PASS. Count should be ~77 original + ~50 new = ~127 tests total.

- [ ] **Step 2: Verify build**

Run: `npx nx build event-processor`
Expected: BUILD SUCCESS

- [ ] **Step 3: Final commit (if any cleanup needed)**

Only if step 1 or 2 revealed issues.
