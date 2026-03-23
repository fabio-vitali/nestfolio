# Ingestion/Egestion Engine Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the event-processor engine layer to ingestion/egestion semantics, extract a transport-agnostic ingestion core, and implement SQS + Kinesis adapters.

**Architecture:** Bottom-up refactor: extract transport-agnostic `IngestionEngine` from `BatchEngine`, build `SqsIngestionAdapter` and `KinesisIngestionAdapter` on top, rewire pipelines, rename egestion side. All changes inside `libs/event-processor` — zero service-level code changes.

**Tech Stack:** TypeScript, AWS Lambda types (`aws-lambda`), DynamoDB DocumentClient, Jest

**Spec:** `docs/superpowers/specs/2026-03-23-ingestion-egestion-engine-design.md`

---

### Task 1: Core Types (`ingestion-types.ts`)

**Files:**
- Create: `libs/event-processor/src/engine/ingestion-types.ts`
- Test: `libs/event-processor/test/engine/ingestion-types.test.ts`

- [ ] **Step 1: Write the type definition file**

```typescript
// libs/event-processor/src/engine/ingestion-types.ts
import type { BusEvent } from '../platform';

export interface IngestionRecord {
  readonly id: string;
  readonly event: BusEvent;
  readonly metadata: {
    readonly receiveCount?: number;
  };
}

export interface IngestionResult {
  readonly failures: string[];
  readonly metrics: Record<string, number>;
  readonly droppedErrors: Array<{ messageId: string; eventType: string; error: Error; causedBy?: unknown }>;
}

export interface IngestionAdapter<TEvent, TResponse> {
  toRecords(event: TEvent): IngestionRecord[];
  toResponse(result: IngestionResult): TResponse;
}
```

- [ ] **Step 2: Write a compile-time test to verify type exports**

```typescript
// libs/event-processor/test/engine/ingestion-types.test.ts
import type { IngestionRecord, IngestionResult, IngestionAdapter } from '../../src/engine/ingestion-types';

describe('ingestion-types', () => {
  it('IngestionRecord satisfies its shape', () => {
    const record: IngestionRecord = {
      id: 'msg-1',
      event: { id: 'evt-1', type: 'TEST', timestamp: '2026-01-01T00:00:00Z', subject: {}, context: { tenantId: 't1' } },
      metadata: { receiveCount: 1 },
    };
    expect(record.id).toBe('msg-1');
  });

  it('IngestionRecord metadata.receiveCount is optional', () => {
    const record: IngestionRecord = {
      id: 'seq-1',
      event: { id: 'evt-1', type: 'TEST', timestamp: '2026-01-01T00:00:00Z', subject: {}, context: { tenantId: 't1' } },
      metadata: {},
    };
    expect(record.metadata.receiveCount).toBeUndefined();
  });

  it('IngestionResult satisfies its shape', () => {
    const result: IngestionResult = {
      failures: ['msg-1'],
      metrics: { EventProcessed: 1 },
      droppedErrors: [],
    };
    expect(result.failures).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `pnpm nx test event-processor --testPathPattern='ingestion-types'`
Expected: 3 passing tests

- [ ] **Step 4: Commit**

```bash
git add libs/event-processor/src/engine/ingestion-types.ts libs/event-processor/test/engine/ingestion-types.test.ts
git commit -m "feat(event-processor): add IngestionRecord, IngestionResult, IngestionAdapter types"
```

---

### Task 2: Update EventContext to be transport-agnostic

**Files:**
- Modify: `libs/event-processor/src/types/event-context.ts`

- [ ] **Step 1: Run existing tests to establish baseline**

Run: `pnpm nx test event-processor`
Expected: all tests pass

- [ ] **Step 2: Update EventContext**

Change `libs/event-processor/src/types/event-context.ts` from:
```typescript
import type { SQSRecord } from 'aws-lambda';

export interface EventContext {
  readonly eventId: string;
  readonly eventType: string;
  readonly tenantId: string;
  readonly userId?: string;
  readonly timestamp: string;
  readonly receiveCount: number;
  readonly serviceName: string;
  readonly record: SQSRecord;
}
```
To:
```typescript
export interface EventContext {
  readonly eventId: string;
  readonly eventType: string;
  readonly tenantId: string;
  readonly userId?: string;
  readonly timestamp: string;
  readonly receiveCount?: number;
  readonly serviceName: string;
  readonly record: unknown;
}
```

Key changes:
- Remove `import type { SQSRecord }` — no more transport dependency
- `receiveCount: number` → `receiveCount?: number` — optional for Kinesis
- `record: SQSRecord` → `record: unknown` — opaque to handlers

- [ ] **Step 3: Run all tests to verify nothing breaks**

Run: `pnpm nx test event-processor`
Expected: all tests pass (existing code already passes `SQSRecord` which satisfies `unknown`)

- [ ] **Step 4: Run full workspace affected tests**

Run: `pnpm nx affected -t test --base=HEAD~1`
Expected: all pass (no service uses `receiveCount` or `record` typed fields from EventContext)

- [ ] **Step 5: Commit**

```bash
git add libs/event-processor/src/types/event-context.ts
git commit -m "refactor(event-processor): make EventContext transport-agnostic"
```

---

### Task 3: Extract SQS record parser (`parse-sqs-record.ts`)

**Files:**
- Create: `libs/event-processor/src/engine/parse-sqs-record.ts`
- Test: `libs/event-processor/test/engine/parse-sqs-record.test.ts`
- Modify: `libs/event-processor/src/engine/batch-engine.ts` (temporarily, will be replaced later)

- [ ] **Step 1: Write failing tests for parseSqsRecord**

```typescript
// libs/event-processor/test/engine/parse-sqs-record.test.ts
import { parseSqsRecord } from '../../src/engine/parse-sqs-record';
import { fakeSqsRecord } from '../../src/testing/fake-records';

describe('parseSqsRecord', () => {
  it('parses a valid SQS record into an IngestionRecord', () => {
    const sqsRecord = fakeSqsRecord('ORDER_FILLED', { amount: 100 }, { tenantId: 'tenant-1', receiveCount: 2 });
    const result = parseSqsRecord(sqsRecord);

    expect(result.id).toBe(sqsRecord.messageId);
    expect(result.event.type).toBe('ORDER_FILLED');
    expect(result.event.subject).toEqual({ amount: 100 });
    expect(result.event.context).toEqual({ tenantId: 'tenant-1' });
    expect(result.metadata.receiveCount).toBe(2);
  });

  it('parses an EventBridge-wrapped record (detail field)', () => {
    const sqsRecord = fakeSqsRecord('DEPOSIT_INITIATED', { currency: 'USD' });
    const result = parseSqsRecord(sqsRecord);

    expect(result.event.type).toBe('DEPOSIT_INITIATED');
    expect(result.event.subject).toEqual({ currency: 'USD' });
  });

  it('defaults receiveCount to 1 when not provided', () => {
    const sqsRecord = fakeSqsRecord('TEST', {});
    sqsRecord.attributes.ApproximateReceiveCount = '';
    const result = parseSqsRecord(sqsRecord);

    expect(result.metadata.receiveCount).toBe(1);
  });

  it('throws NotRetryableError on malformed JSON', () => {
    const sqsRecord = fakeSqsRecord('TEST', {});
    sqsRecord.body = 'not json';

    expect(() => parseSqsRecord(sqsRecord)).toThrow('Malformed SQS message body');
  });

  it('throws NotRetryableError when subject is missing', () => {
    const sqsRecord = fakeSqsRecord('TEST', {});
    sqsRecord.body = JSON.stringify({ detail: { id: '1', type: 'T', timestamp: 'now', context: { tenantId: 't1' } } });

    expect(() => parseSqsRecord(sqsRecord)).toThrow('missing "subject"');
  });

  it('throws NotRetryableError when type is missing', () => {
    const sqsRecord = fakeSqsRecord('TEST', {});
    sqsRecord.body = JSON.stringify({ detail: { id: '1', timestamp: 'now', subject: {}, context: { tenantId: 't1' } } });

    expect(() => parseSqsRecord(sqsRecord)).toThrow('missing "type"');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx test event-processor --testPathPattern='parse-sqs-record'`
Expected: FAIL — module not found

- [ ] **Step 3: Implement parseSqsRecord**

```typescript
// libs/event-processor/src/engine/parse-sqs-record.ts
import type { SQSRecord } from 'aws-lambda';
import type { IngestionRecord } from './ingestion-types';
import { NotRetryableError } from '../internal';

export function parseSqsRecord(sqsRecord: SQSRecord): IngestionRecord {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(sqsRecord.body);
  } catch {
    throw new NotRetryableError(
      'Malformed SQS message body: unable to parse JSON',
      { messageId: sqsRecord.messageId },
    );
  }

  const event = (body.detail ?? body) as Record<string, unknown>;

  if (!event.subject) {
    throw new NotRetryableError(
      'Invalid event: missing "subject" field',
      { messageId: sqsRecord.messageId },
    );
  }

  if (!event.type) {
    throw new NotRetryableError(
      'Invalid event: missing "type" field',
      { messageId: sqsRecord.messageId },
    );
  }

  if (!(event.context as Record<string, unknown>)?.tenantId) {
    throw new NotRetryableError(
      'Invalid event: missing "context.tenantId" field',
      { messageId: sqsRecord.messageId },
    );
  }

  const receiveCount = parseInt(sqsRecord.attributes?.ApproximateReceiveCount ?? '1', 10) || 1;

  return {
    id: sqsRecord.messageId,
    event: event as any,
    metadata: { receiveCount },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm nx test event-processor --testPathPattern='parse-sqs-record'`
Expected: all 6 tests pass

- [ ] **Step 5: Commit**

```bash
git add libs/event-processor/src/engine/parse-sqs-record.ts libs/event-processor/test/engine/parse-sqs-record.test.ts
git commit -m "feat(event-processor): extract parseSqsRecord from internal parseRecord"
```

---

### Task 4: Kinesis record parser (`parse-kinesis-record.ts`)

**Files:**
- Create: `libs/event-processor/src/engine/parse-kinesis-record.ts`
- Test: `libs/event-processor/test/engine/parse-kinesis-record.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// libs/event-processor/test/engine/parse-kinesis-record.test.ts
import { parseKinesisRecord } from '../../src/engine/parse-kinesis-record';
import type { KinesisStreamRecord } from 'aws-lambda';

function fakeKinesisRecord(event: Record<string, unknown>, opts?: { sequenceNumber?: string }): KinesisStreamRecord {
  const data = Buffer.from(JSON.stringify(event)).toString('base64');
  return {
    kinesis: {
      kinesisSchemaVersion: '1.0',
      partitionKey: 'pk-1',
      sequenceNumber: opts?.sequenceNumber ?? '123456',
      data,
      approximateArrivalTimestamp: Date.now() / 1000,
    },
    eventSource: 'aws:kinesis',
    eventVersion: '1.0',
    eventID: 'shardId-000:123456',
    eventName: 'aws:kinesis:record',
    invokeIdentityArn: 'arn:aws:iam::role/test',
    awsRegion: 'us-east-1',
    eventSourceARN: 'arn:aws:kinesis:us-east-1:000:stream/test',
  };
}

describe('parseKinesisRecord', () => {
  it('decodes base64 data into an IngestionRecord', () => {
    const busEvent = { id: 'evt-1', type: 'ORDER_FILLED', timestamp: '2026-01-01T00:00:00Z', subject: { amount: 100 }, context: { tenantId: 't1' } };
    const record = fakeKinesisRecord(busEvent, { sequenceNumber: 'seq-99' });
    const result = parseKinesisRecord(record);

    expect(result.id).toBe('seq-99');
    expect(result.event.type).toBe('ORDER_FILLED');
    expect(result.event.subject).toEqual({ amount: 100 });
    expect(result.metadata.receiveCount).toBeUndefined();
  });

  it('handles EventBridge-wrapped events (detail field)', () => {
    const wrapped = { detail: { id: 'evt-1', type: 'TEST', timestamp: 'now', subject: { a: 1 }, context: { tenantId: 't1' } } };
    const record = fakeKinesisRecord(wrapped);
    const result = parseKinesisRecord(record);

    expect(result.event.type).toBe('TEST');
    expect(result.event.subject).toEqual({ a: 1 });
  });

  it('throws NotRetryableError on malformed base64/JSON', () => {
    const record = fakeKinesisRecord({});
    record.kinesis.data = 'not-valid-base64!!!';

    expect(() => parseKinesisRecord(record)).toThrow('Malformed Kinesis record');
  });

  it('throws NotRetryableError when subject is missing', () => {
    const record = fakeKinesisRecord({ id: '1', type: 'T', timestamp: 'now', context: { tenantId: 't1' } });
    expect(() => parseKinesisRecord(record)).toThrow('missing "subject"');
  });

  it('throws NotRetryableError when type is missing', () => {
    const record = fakeKinesisRecord({ id: '1', timestamp: 'now', subject: {}, context: { tenantId: 't1' } });
    expect(() => parseKinesisRecord(record)).toThrow('missing "type"');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx test event-processor --testPathPattern='parse-kinesis-record'`
Expected: FAIL — module not found

- [ ] **Step 3: Implement parseKinesisRecord**

```typescript
// libs/event-processor/src/engine/parse-kinesis-record.ts
import type { KinesisStreamRecord } from 'aws-lambda';
import type { IngestionRecord } from './ingestion-types';
import { NotRetryableError } from '../internal';

export function parseKinesisRecord(kinesisRecord: KinesisStreamRecord): IngestionRecord {
  let body: Record<string, unknown>;
  try {
    const decoded = Buffer.from(kinesisRecord.kinesis.data, 'base64').toString('utf-8');
    body = JSON.parse(decoded);
  } catch {
    throw new NotRetryableError(
      'Malformed Kinesis record: unable to decode base64 or parse JSON',
      { sequenceNumber: kinesisRecord.kinesis.sequenceNumber },
    );
  }

  const event = (body.detail ?? body) as Record<string, unknown>;

  if (!event.subject) {
    throw new NotRetryableError(
      'Invalid event: missing "subject" field',
      { sequenceNumber: kinesisRecord.kinesis.sequenceNumber },
    );
  }

  if (!event.type) {
    throw new NotRetryableError(
      'Invalid event: missing "type" field',
      { sequenceNumber: kinesisRecord.kinesis.sequenceNumber },
    );
  }

  if (!(event.context as Record<string, unknown>)?.tenantId) {
    throw new NotRetryableError(
      'Invalid event: missing "context.tenantId" field',
      { sequenceNumber: kinesisRecord.kinesis.sequenceNumber },
    );
  }

  return {
    id: kinesisRecord.kinesis.sequenceNumber,
    event: event as any,
    metadata: {},
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm nx test event-processor --testPathPattern='parse-kinesis-record'`
Expected: all 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add libs/event-processor/src/engine/parse-kinesis-record.ts libs/event-processor/test/engine/parse-kinesis-record.test.ts
git commit -m "feat(event-processor): add parseKinesisRecord (base64 decode + BusEvent parse)"
```

---

### Task 5: IngestionEngine core

**Files:**
- Create: `libs/event-processor/src/engine/ingestion-engine.ts`
- Test: `libs/event-processor/test/engine/ingestion-engine.test.ts`

- [ ] **Step 1: Write failing tests**

The test file should mock `../internal` the same way `batch-engine.test.ts` does. Create tests for:

1. Routes records to correct handlers by event type, returns empty failures on success
2. Skips unknown event types without error (records EventSkipped metric)
3. Collects retryable errors as failures in IngestionResult
4. Drops non-retryable errors (records EventDropped metric, includes in droppedErrors)
5. Processes multiple records with mixed outcomes (success + retryable + skipped)
6. Records deduplication when IntentExecutor returns `{ deduplicated: true }`
7. Publishes non-retryable errors to EventBridge when busName is configured

The test should instantiate `IngestionEngine` directly, passing `IngestionRecord[]` to `process()` — no SQS or Kinesis types involved.

Use mock structure from existing `batch-engine.test.ts`:
- Mock `../internal` for `isRetryable`, `traceEvent`, `extractTenantId`
- Mock `DynamoDBDocumentClient` as `{ send: jest.fn() }`
- Use `record()` intent helper for handler definitions

Helper to build `IngestionRecord`:
```typescript
function makeRecord(type: string, payload: Record<string, unknown>, opts?: { id?: string; receiveCount?: number }): IngestionRecord {
  return {
    id: opts?.id ?? `msg-${Math.random().toString(36).slice(2)}`,
    event: { id: `evt-1`, type, timestamp: '2026-01-01T00:00:00Z', subject: payload, context: { tenantId: 'tenant-1' } } as any,
    metadata: { receiveCount: opts?.receiveCount },
  };
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx test event-processor --testPathPattern='ingestion-engine'`
Expected: FAIL — module not found

- [ ] **Step 3: Implement IngestionEngine**

Extract the core processing logic from `batch-engine.ts` (lines 47-136) into `ingestion-engine.ts`. The key difference: `process()` receives `IngestionRecord[]` instead of `SQSEvent`, and returns `IngestionResult` instead of `SQSBatchResponse`.

```typescript
// libs/event-processor/src/engine/ingestion-engine.ts
import { isRetryable, traceEvent, extractTenantId } from '../internal';
import type { HandlerEntry } from '../types/handler-config';
import type { EventContext } from '../types/event-context';
import { normalizeHandler } from './normalize-handler';
import { IntentExecutor } from './intent-executor';
import { ErrorCollector } from './error-collector';
import { asyncPool } from '../util/async-pool';
import { ErrorEventPublisher } from './error-event-publisher';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { S3Client } from '@aws-sdk/client-s3';
import type { IngestionRecord, IngestionResult } from './ingestion-types';

const DEFAULT_CONCURRENCY = 5;

export interface IngestionEngineConfig {
  serviceName: string;
  handlers: Record<string, HandlerEntry>;
  docClient: DynamoDBDocumentClient;
  tableName: string;
  busName?: string;
  concurrency?: number;
  errorEventType?: string;
  s3Client?: S3Client;
  bucket?: string;
}

export class IngestionEngine {
  private readonly normalizedHandlers: Map<string, ReturnType<typeof normalizeHandler>>;
  private readonly intentExecutor: IntentExecutor;
  private readonly errorPublisher?: ErrorEventPublisher;
  private readonly config: IngestionEngineConfig;

  constructor(config: IngestionEngineConfig) {
    this.config = config;
    this.intentExecutor = new IntentExecutor({
      docClient: config.docClient,
      tableName: config.tableName,
      s3Client: config.s3Client,
      bucket: config.bucket,
    });
    if (config.busName) {
      this.errorPublisher = new ErrorEventPublisher(config.busName, config.serviceName);
    }
    this.normalizedHandlers = new Map();
    for (const [eventType, entry] of Object.entries(config.handlers)) {
      this.normalizedHandlers.set(eventType, normalizeHandler(entry));
    }
  }

  async process(records: IngestionRecord[]): Promise<IngestionResult> {
    const startedAt = Date.now();
    const collector = new ErrorCollector();
    const concurrency = this.config.concurrency ?? DEFAULT_CONCURRENCY;

    await asyncPool(
      records,
      async (ingestionRecord) => {
        const { id, event, metadata } = ingestionRecord;
        let parsedPayload: unknown;

        try {
          const eventType = event.type;
          parsedPayload = { type: event.type, subject: event.subject, id: event.id };

          const tenantId = extractTenantId(event);
          traceEvent(eventType, event.id, tenantId);

          // Route
          const handler = this.normalizedHandlers.get(eventType);
          if (!handler) {
            collector.recordSkipped(id);
            return;
          }

          // Build context
          const ctx: EventContext = {
            eventId: event.id,
            eventType,
            tenantId,
            userId: event.context?.userId as string | undefined,
            timestamp: event.timestamp,
            receiveCount: metadata.receiveCount,
            serviceName: this.config.serviceName,
            record: ingestionRecord,
          };

          // Execute handler → intents
          const intents = await handler({ subject: event.subject, context: event.context }, ctx);

          // Execute intents
          let anyDeduplicated = false;
          for (const intent of intents) {
            const result = await this.intentExecutor.execute(intent, ctx);
            if (result.deduplicated) anyDeduplicated = true;
          }

          if (anyDeduplicated) {
            collector.recordDeduplicated(id, eventType);
          } else {
            collector.recordSuccess(id, eventType);
          }
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          const retryable = isRetryable(err);
          collector.recordError(id, err, retryable, parsedPayload);
        }
      },
      { concurrency },
    );

    const results = collector.getResults();

    // Publish non-retryable errors to bus
    if (results.droppedErrors.length > 0 && this.errorPublisher) {
      const errorType = this.config.errorEventType
        ?? `${this.config.serviceName.toUpperCase().replace(/-/g, '_')}_FAILED`;
      await this.errorPublisher.publishErrors(
        results.droppedErrors.map(({ error, causedBy }) => ({ error, causedBy })),
        errorType,
      );
    }

    // BatchDuration metric
    results.metrics.BatchDuration = Date.now() - startedAt;

    return {
      failures: results.batchItemFailures,
      metrics: results.metrics,
      droppedErrors: results.droppedErrors,
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm nx test event-processor --testPathPattern='ingestion-engine'`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add libs/event-processor/src/engine/ingestion-engine.ts libs/event-processor/test/engine/ingestion-engine.test.ts
git commit -m "feat(event-processor): add IngestionEngine — transport-agnostic core"
```

---

### Task 6: SQS Adapter (`sqs-adapter.ts`)

**Files:**
- Create: `libs/event-processor/src/engine/sqs-adapter.ts`
- Test: `libs/event-processor/test/engine/sqs-adapter.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:
1. `toRecords()` converts `SQSEvent.Records` to `IngestionRecord[]` via `parseSqsRecord`
2. `toRecords()` filters out poison pills (receiveCount > max) — filtered records are NOT in the output
3. `toRecords()` handles parse errors by wrapping them in IngestionRecord with a special marker (or re-throws)
4. `toResponse()` maps `IngestionResult.failures` to `SQSBatchResponse.batchItemFailures`
5. `toResponse()` returns empty `batchItemFailures` when no failures

Use `fakeSqsRecord` from `../../src/testing/fake-records` for test data.

Note: The adapter itself does NOT own the `ErrorCollector`. The adapter's `toRecords()` simply skips poison pills and returns the remaining parsed records. Poison pill metrics will be handled by passing a collector reference or by the factory that orchestrates adapter + engine.

Alternative simpler design: `toRecords()` returns all records including poison pills, but marks them. The factory layer handles the metric. Keep it simple — just skip poison pills in `toRecords()` and let the factory log the metric.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx test event-processor --testPathPattern='sqs-adapter'`
Expected: FAIL — module not found

- [ ] **Step 3: Implement SqsIngestionAdapter**

```typescript
// libs/event-processor/src/engine/sqs-adapter.ts
import type { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import type { IngestionRecord, IngestionResult, IngestionAdapter } from './ingestion-types';
import { parseSqsRecord } from './parse-sqs-record';

const DEFAULT_POISON_PILL_MAX = 5;

export interface SqsAdapterOptions {
  poisonPillMaxReceiveCount?: number;
}

export interface SqsToRecordsResult {
  records: IngestionRecord[];
  poisonPills: number;
}

export interface SqsToRecordsOutput {
  records: IngestionRecord[];
  poisonPillCount: number;
}

export class SqsIngestionAdapter implements IngestionAdapter<SQSEvent, SQSBatchResponse> {
  private readonly maxReceive: number;

  constructor(options?: SqsAdapterOptions) {
    this.maxReceive = options?.poisonPillMaxReceiveCount ?? DEFAULT_POISON_PILL_MAX;
  }

  /**
   * Parses SQS records and filters out poison pills.
   * Returns both the parsed records and the count of filtered poison pills
   * so the caller (factory) can record the metric on the ErrorCollector.
   */
  toRecords(event: SQSEvent): IngestionRecord[] {
    const records: IngestionRecord[] = [];
    for (const sqsRecord of event.Records) {
      const receiveCount = parseInt(sqsRecord.attributes?.ApproximateReceiveCount ?? '1', 10);
      if (receiveCount > this.maxReceive) {
        continue; // poison pill — skip
      }
      records.push(parseSqsRecord(sqsRecord));
    }
    return records;
  }

  /**
   * Returns the number of poison pills filtered from the last toRecords() call.
   * The factory calls this to record PoisonPillDetected metrics on the ErrorCollector.
   */
  countPoisonPills(event: SQSEvent): number {
    let count = 0;
    for (const sqsRecord of event.Records) {
      const receiveCount = parseInt(sqsRecord.attributes?.ApproximateReceiveCount ?? '1', 10);
      if (receiveCount > this.maxReceive) count++;
    }
    return count;
  }

  toResponse(result: IngestionResult): SQSBatchResponse {
    return {
      batchItemFailures: result.failures.map((id) => ({ itemIdentifier: id })),
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm nx test event-processor --testPathPattern='sqs-adapter'`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add libs/event-processor/src/engine/sqs-adapter.ts libs/event-processor/test/engine/sqs-adapter.test.ts
git commit -m "feat(event-processor): add SqsIngestionAdapter"
```

---

### Task 7: Kinesis Adapter (`kinesis-adapter.ts`)

**Files:**
- Create: `libs/event-processor/src/engine/kinesis-adapter.ts`
- Test: `libs/event-processor/test/engine/kinesis-adapter.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:
1. `toRecords()` decodes Kinesis records via `parseKinesisRecord`
2. `toRecords()` handles multiple records
3. `toRecords()` sets id to sequenceNumber
4. `toRecords()` does NOT filter poison pills (no receiveCount concept)
5. `toResponse()` maps failures to `KinesisStreamBatchResponse.batchItemFailures`
6. `toResponse()` returns empty batchItemFailures when no failures

Use the `fakeKinesisRecord` helper from Task 4 (extract to `fake-records.ts` or inline).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx test event-processor --testPathPattern='kinesis-adapter'`
Expected: FAIL — module not found

- [ ] **Step 3: Implement KinesisIngestionAdapter**

```typescript
// libs/event-processor/src/engine/kinesis-adapter.ts
import type { KinesisStreamEvent, KinesisStreamBatchResponse } from 'aws-lambda';
import type { IngestionRecord, IngestionResult, IngestionAdapter } from './ingestion-types';
import { parseKinesisRecord } from './parse-kinesis-record';

export class KinesisIngestionAdapter implements IngestionAdapter<KinesisStreamEvent, KinesisStreamBatchResponse> {
  toRecords(event: KinesisStreamEvent): IngestionRecord[] {
    return event.Records.map((record) => parseKinesisRecord(record));
  }

  toResponse(result: IngestionResult): KinesisStreamBatchResponse {
    return {
      batchItemFailures: result.failures.map((id) => ({ itemIdentifier: id })),
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm nx test event-processor --testPathPattern='kinesis-adapter'`
Expected: all tests pass

- [ ] **Step 5: Add `fakeKinesisRecord` to fake-records.ts for reuse**

Add to `libs/event-processor/src/testing/fake-records.ts`:

```typescript
import type { KinesisStreamRecord } from 'aws-lambda';

export function fakeKinesisRecord(
  eventType: string,
  payload: Record<string, unknown>,
  opts?: { eventId?: string; tenantId?: string; sequenceNumber?: string },
): KinesisStreamRecord {
  const eventId = opts?.eventId ?? randomUUID();
  const tenantId = opts?.tenantId ?? 'test-tenant';
  const event = {
    id: eventId,
    type: eventType,
    timestamp: new Date().toISOString(),
    subject: payload,
    context: { tenantId },
  };
  const data = Buffer.from(JSON.stringify(event)).toString('base64');

  return {
    kinesis: {
      kinesisSchemaVersion: '1.0',
      partitionKey: `T#${tenantId}`,
      sequenceNumber: opts?.sequenceNumber ?? randomUUID(),
      data,
      approximateArrivalTimestamp: Date.now() / 1000,
    },
    eventSource: 'aws:kinesis',
    eventVersion: '1.0',
    eventID: `shardId-000:${randomUUID()}`,
    eventName: 'aws:kinesis:record',
    invokeIdentityArn: 'arn:aws:iam::role/test',
    awsRegion: 'us-east-1',
    eventSourceARN: 'arn:aws:kinesis:us-east-1:000000000000:stream/test',
  };
}
```

- [ ] **Step 6: Commit**

```bash
git add libs/event-processor/src/engine/kinesis-adapter.ts libs/event-processor/test/engine/kinesis-adapter.test.ts libs/event-processor/src/testing/fake-records.ts
git commit -m "feat(event-processor): add KinesisIngestionAdapter + fakeKinesisRecord helper"
```

---

### Task 8: Unified factory (`create-ingestion-handler.ts`)

**Files:**
- Create: `libs/event-processor/src/engine/create-ingestion-handler.ts`
- Test: `libs/event-processor/test/engine/create-ingestion-handler.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:
1. Returns a function when transport is 'sqs' (default)
2. Returns a function when transport is 'kinesis'
3. SQS path: processes SQSEvent and returns SQSBatchResponse with empty batchItemFailures
4. Kinesis path: processes KinesisStreamEvent and returns KinesisStreamBatchResponse with empty batchItemFailures
5. SQS path: retryable error returns batchItemFailures with messageId
6. Kinesis path: retryable error returns batchItemFailures with sequenceNumber

Mock `../internal` same as existing `create-event-handler.test.ts`.
Use `fakeSqsRecord` and `fakeKinesisRecord` for test data.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx test event-processor --testPathPattern='create-ingestion-handler'`
Expected: FAIL — module not found

- [ ] **Step 3: Implement createIngestionHandler**

```typescript
// libs/event-processor/src/engine/create-ingestion-handler.ts
import type { SQSEvent, SQSBatchResponse, KinesisStreamEvent, KinesisStreamBatchResponse, Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { applyMiddleware, withLambdaContext, withTiming } from '../internal';
import type { HandlerEntry } from '../types/handler-config';
import { IngestionEngine } from './ingestion-engine';
import { SqsIngestionAdapter } from './sqs-adapter';
import { KinesisIngestionAdapter } from './kinesis-adapter';

export interface IngestionHandlerConfig {
  transport?: 'sqs' | 'kinesis';
  serviceName: string;
  handlers: Record<string, HandlerEntry>;
  table?: string | { name: string; client: DynamoDBDocumentClient };
  bus?: string;
  s3?: { bucket: string };
  concurrency?: number;
  poisonPill?: { maxReceiveCount: number };
  errorEventType?: string;
}

export function createIngestionHandler(
  config: IngestionHandlerConfig & { transport?: 'sqs' },
): (event: SQSEvent, context?: Context) => Promise<SQSBatchResponse>;

export function createIngestionHandler(
  config: IngestionHandlerConfig & { transport: 'kinesis' },
): (event: KinesisStreamEvent, context?: Context) => Promise<KinesisStreamBatchResponse>;

export function createIngestionHandler(
  config: IngestionHandlerConfig,
): ((event: SQSEvent, context?: Context) => Promise<SQSBatchResponse>) |
   ((event: KinesisStreamEvent, context?: Context) => Promise<KinesisStreamBatchResponse>) {
  const tableName = typeof config.table === 'string'
    ? config.table
    : config.table?.name ?? process.env.TABLE_NAME!;

  const docClient = typeof config.table === 'object' && 'client' in config.table
    ? config.table.client
    : DynamoDBDocumentClient.from(new DynamoDBClient({}));

  const s3Client = config.s3 ? new S3Client({}) : undefined;

  const engine = new IngestionEngine({
    serviceName: config.serviceName,
    handlers: config.handlers,
    docClient,
    tableName,
    busName: typeof config.bus === 'string' ? config.bus : process.env.BUS_NAME,
    concurrency: config.concurrency,
    errorEventType: config.errorEventType,
    s3Client,
    bucket: config.s3?.bucket,
  });

  if (config.transport === 'kinesis') {
    const adapter = new KinesisIngestionAdapter();

    const handler = async (event: unknown): Promise<KinesisStreamBatchResponse> => {
      const records = adapter.toRecords(event as KinesisStreamEvent);
      const result = await engine.process(records);
      return adapter.toResponse(result);
    };

    return applyMiddleware(
      handler,
      withLambdaContext(),
      withTiming(`${config.serviceName}-event-listener`),
    ) as (event: KinesisStreamEvent, context?: Context) => Promise<KinesisStreamBatchResponse>;
  }

  // Default: SQS
  const adapter = new SqsIngestionAdapter({
    poisonPillMaxReceiveCount: config.poisonPill?.maxReceiveCount,
  });

  const handler = async (event: unknown): Promise<SQSBatchResponse> => {
    const sqsEvent = event as SQSEvent;
    const records = adapter.toRecords(sqsEvent);
    const result = await engine.process(records);
    // Track poison pill metrics (adapter detects, result tracks)
    const poisonPills = adapter.countPoisonPills(sqsEvent);
    if (poisonPills > 0) {
      result.metrics.PoisonPillDetected = (result.metrics.PoisonPillDetected ?? 0) + poisonPills;
      result.metrics.BatchSize = (result.metrics.BatchSize ?? 0) + poisonPills;
    }
    return adapter.toResponse(result);
  };

  return applyMiddleware(
    handler,
    withLambdaContext(),
    withTiming(`${config.serviceName}-event-listener`),
  ) as (event: SQSEvent, context?: Context) => Promise<SQSBatchResponse>;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm nx test event-processor --testPathPattern='create-ingestion-handler'`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add libs/event-processor/src/engine/create-ingestion-handler.ts libs/event-processor/test/engine/create-ingestion-handler.test.ts
git commit -m "feat(event-processor): add createIngestionHandler factory with SQS/Kinesis overloads"
```

---

### Task 9: Rewire `materializeToTable` pipeline

**Files:**
- Modify: `libs/event-processor/src/pipelines/materialize-to-table.ts`

- [ ] **Step 1: Run existing materialize-to-table tests to establish baseline**

Run: `pnpm nx test event-processor`
Expected: all pass

- [ ] **Step 2: Update materializeToTable to use createIngestionHandler**

Replace contents of `libs/event-processor/src/pipelines/materialize-to-table.ts`:

```typescript
import type { SQSEvent, SQSBatchResponse, KinesisStreamEvent, KinesisStreamBatchResponse, Context } from 'aws-lambda';
import type { HandlerEntry } from '../types/handler-config';
import { createIngestionHandler } from '../engine/create-ingestion-handler';

export interface MaterializeToTableConfig {
  serviceName: string;
  handlers: Record<string, HandlerEntry>;
  table?: string;
  bus?: string;
  concurrency?: number;
  poisonPill?: { maxReceiveCount: number };
  errorEventType?: string;
}

export function materializeToTable(
  config: MaterializeToTableConfig & { transport?: 'sqs' },
): (event: SQSEvent, context?: Context) => Promise<SQSBatchResponse>;

export function materializeToTable(
  config: MaterializeToTableConfig & { transport: 'kinesis' },
): (event: KinesisStreamEvent, context?: Context) => Promise<KinesisStreamBatchResponse>;

export function materializeToTable(
  config: MaterializeToTableConfig & { transport?: 'sqs' | 'kinesis' },
): any {
  return createIngestionHandler({
    serviceName: config.serviceName,
    handlers: config.handlers,
    table: config.table ?? process.env.TABLE_NAME!,
    bus: config.bus ?? process.env.BUS_NAME,
    concurrency: config.concurrency,
    poisonPill: config.poisonPill,
    errorEventType: config.errorEventType,
    transport: config.transport,
  } as any);
}
```

- [ ] **Step 3: Run all event-processor tests**

Run: `pnpm nx test event-processor`
Expected: all pass — materializeToTable still delegates to the same logic, just through new internals

- [ ] **Step 4: Run affected workspace tests**

Run: `pnpm nx affected -t test --base=HEAD~1`
Expected: all 19 services pass (materializeToTable signature unchanged for SQS default path)

- [ ] **Step 5: Commit**

```bash
git add libs/event-processor/src/pipelines/materialize-to-table.ts
git commit -m "refactor(event-processor): rewire materializeToTable to use createIngestionHandler"
```

---

### Task 10: Rename egestion files

**Files:**
- Rename: `libs/event-processor/src/engine/stream-engine.ts` → `libs/event-processor/src/engine/egestion-engine.ts`
- Rename: `libs/event-processor/src/engine/create-stream-handler.ts` → `libs/event-processor/src/engine/create-egestion-handler.ts`
- Rename: `libs/event-processor/test/engine/stream-engine.test.ts` → `libs/event-processor/test/engine/egestion-engine.test.ts`
- Rename: `libs/event-processor/test/engine/create-stream-handler.test.ts` → `libs/event-processor/test/engine/create-egestion-handler.test.ts`
- Modify: all files that import from renamed files

- [ ] **Step 1: Rename source files via git mv**

```bash
git mv libs/event-processor/src/engine/stream-engine.ts libs/event-processor/src/engine/egestion-engine.ts
git mv libs/event-processor/src/engine/create-stream-handler.ts libs/event-processor/src/engine/create-egestion-handler.ts
git mv libs/event-processor/test/engine/stream-engine.test.ts libs/event-processor/test/engine/egestion-engine.test.ts
git mv libs/event-processor/test/engine/create-stream-handler.test.ts libs/event-processor/test/engine/create-egestion-handler.test.ts
```

- [ ] **Step 2: Rename class/type/function inside egestion-engine.ts**

In `egestion-engine.ts`:
- `StreamEngine` → `EgestionEngine`
- `StreamEngineConfig` → `EgestionEngineConfig`
- `StreamBatchError` → `EgestionBatchError` (keep `StreamBatchError` as deprecated alias: `/** @deprecated Use EgestionBatchError */ export { EgestionBatchError as StreamBatchError }`)

In `create-egestion-handler.ts`:
- `createStreamHandler` → `createEgestionHandler`
- `StreamHandlerConfig` → `EgestionHandlerConfig`
- Update import from `./stream-engine` → `./egestion-engine`

- [ ] **Step 3: Update imports in pipeline files**

In `libs/event-processor/src/pipelines/change-data-capture.ts`:
- `import { StreamEngine } from '../engine/stream-engine'` → `import { EgestionEngine } from '../engine/egestion-engine'`
- `new StreamEngine(...)` → `new EgestionEngine(...)`

In `libs/event-processor/src/pipelines/replay-and-reduce.ts`:
- Same pattern

- [ ] **Step 4: Update test files**

In `egestion-engine.test.ts`:
- Update import path and class name references
In `create-egestion-handler.test.ts`:
- Update import path and function name references

- [ ] **Step 5: Run all tests**

Run: `pnpm nx test event-processor`
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add -A libs/event-processor/
git commit -m "refactor(event-processor): rename StreamEngine → EgestionEngine"
```

---

### Task 11: Delete old files and update exports

**Files:**
- Delete: `libs/event-processor/src/engine/batch-engine.ts`
- Delete: `libs/event-processor/src/engine/create-event-handler.ts`
- Delete: `libs/event-processor/test/engine/batch-engine.test.ts`
- Delete: `libs/event-processor/test/engine/create-event-handler.test.ts`
- Modify: `libs/event-processor/src/engine/index.ts`
- Modify: `libs/event-processor/src/index.ts`
- Modify: `libs/event-processor/src/lambda/index.ts` (remove `parseRecord` re-export)
- Modify: `libs/event-processor/src/internal/index.ts` (remove `parseRecord` export)

- [ ] **Step 1: Delete old engine files**

```bash
rm libs/event-processor/src/engine/batch-engine.ts
rm libs/event-processor/src/engine/create-event-handler.ts
rm libs/event-processor/test/engine/batch-engine.test.ts
rm libs/event-processor/test/engine/create-event-handler.test.ts
```

- [ ] **Step 2: Update engine/index.ts**

Replace `libs/event-processor/src/engine/index.ts` contents:

```typescript
export { normalizeHandler } from './normalize-handler';
export { IntentExecutor } from './intent-executor';
export { BaseCollector } from './base-collector';
export type { CollectedError } from './base-collector';
export { ErrorCollector } from './error-collector';
export type { CollectorResults } from './error-collector';
export { ErrorEventPublisher } from './error-event-publisher';
export { StreamCollector } from './stream-collector';

// Ingestion
export { IngestionEngine } from './ingestion-engine';
export type { IngestionEngineConfig } from './ingestion-engine';
export type { IngestionRecord, IngestionResult, IngestionAdapter } from './ingestion-types';
export { SqsIngestionAdapter } from './sqs-adapter';
export type { SqsAdapterOptions } from './sqs-adapter';
export { KinesisIngestionAdapter } from './kinesis-adapter';
export { createIngestionHandler } from './create-ingestion-handler';
export type { IngestionHandlerConfig } from './create-ingestion-handler';
export { parseSqsRecord } from './parse-sqs-record';
export { parseKinesisRecord } from './parse-kinesis-record';

// Egestion
export { EgestionEngine, EgestionBatchError } from './egestion-engine';
export { EgestionBatchError as StreamBatchError } from './egestion-engine';
export type { EgestionEngineConfig } from './egestion-engine';
export { createEgestionHandler } from './create-egestion-handler';
export type { EgestionHandlerConfig } from './create-egestion-handler';
```

- [ ] **Step 3: Update main index.ts**

In `libs/event-processor/src/index.ts`, replace the "Engine (advanced)" block:

From:
```typescript
// Engine (advanced)
export { BatchEngine } from './engine/batch-engine';
export { IntentExecutor } from './engine/intent-executor';
export { ErrorCollector } from './engine/error-collector';
export { ErrorEventPublisher } from './engine/error-event-publisher';
export { StreamEngine, StreamBatchError } from './engine/stream-engine';
export { StreamCollector } from './engine/stream-collector';
export { BaseCollector } from './engine/base-collector';
export type { CollectedError } from './engine/base-collector';
```

To:
```typescript
// Engine (advanced) — Ingestion
export { IngestionEngine } from './engine/ingestion-engine';
export type { IngestionEngineConfig } from './engine/ingestion-engine';
export type { IngestionRecord, IngestionResult, IngestionAdapter } from './engine/ingestion-types';
export { SqsIngestionAdapter } from './engine/sqs-adapter';
export { KinesisIngestionAdapter } from './engine/kinesis-adapter';
export { createIngestionHandler } from './engine/create-ingestion-handler';
export type { IngestionHandlerConfig } from './engine/create-ingestion-handler';
export { parseSqsRecord } from './engine/parse-sqs-record';
export { parseKinesisRecord } from './engine/parse-kinesis-record';

// Engine (advanced) — Egestion
export { EgestionEngine, EgestionBatchError } from './engine/egestion-engine';
export { EgestionBatchError as StreamBatchError } from './engine/egestion-engine';
export type { EgestionEngineConfig } from './engine/egestion-engine';
export { createEgestionHandler } from './engine/create-egestion-handler';
export type { EgestionHandlerConfig } from './engine/create-egestion-handler';

// Engine (advanced) — Shared
export { IntentExecutor } from './engine/intent-executor';
export { ErrorCollector } from './engine/error-collector';
export { ErrorEventPublisher } from './engine/error-event-publisher';
export { StreamCollector } from './engine/stream-collector';
export { BaseCollector } from './engine/base-collector';
export type { CollectedError } from './engine/base-collector';
```

Also update the lambda re-exports — remove `parseRecord` from the lambda re-export block (it's been replaced by `parseSqsRecord`):
- Remove `parseRecord` from the `export { ... } from './lambda';` block in `libs/event-processor/src/index.ts`
- Remove `export { parseRecord } from '../internal';` from `libs/event-processor/src/lambda/index.ts`
- Remove `export { parseRecord } from './sqs-parser';` from `libs/event-processor/src/internal/index.ts`
- The file `libs/event-processor/src/internal/sqs-parser.ts` can remain (it's still used internally by `parseSqsRecord` if needed), but its export is removed from barrels

- [ ] **Step 4: Check for any remaining imports of old names**

Search for any remaining references to `BatchEngine`, `createEventHandler`, `StreamEngine`, `createStreamHandler` across the entire workspace. Fix any found.

Run: `grep -r "BatchEngine\|createEventHandler\b\|StreamEngine\|createStreamHandler" libs/event-processor/src/ --include='*.ts'`
Expected: no matches (or only the deprecated alias for `StreamBatchError`)

- [ ] **Step 5: Run all event-processor tests**

Run: `pnpm nx test event-processor`
Expected: all pass

- [ ] **Step 6: Run full workspace tests**

Run: `pnpm nx run-many -t test --all`
Expected: all projects pass

- [ ] **Step 7: Commit**

```bash
git add -A libs/event-processor/
git commit -m "refactor(event-processor): remove old BatchEngine/StreamEngine, update exports"
```

---

### Task 12: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Run full workspace build**

Run: `pnpm nx run-many -t build --all`
Expected: all projects build

- [ ] **Step 2: Run full workspace test**

Run: `pnpm nx run-many -t test --all`
Expected: all projects pass

- [ ] **Step 3: Run full workspace lint**

Run: `pnpm nx run-many -t lint --all`
Expected: all projects pass

- [ ] **Step 4: Verify no service files changed**

Run: `git diff --name-only HEAD~12 HEAD -- services/`
Expected: no files listed (all changes confined to `libs/event-processor/`)

- [ ] **Step 5: Verify public API surface**

Grep the main `index.ts` to confirm:
- `IngestionEngine`, `createIngestionHandler`, `SqsIngestionAdapter`, `KinesisIngestionAdapter` are exported
- `EgestionEngine`, `createEgestionHandler` are exported
- `StreamBatchError` deprecated alias is exported
- `BatchEngine`, `createEventHandler` are NOT exported
- `materializeToTable`, `changeDataCapture`, `replayAndReduce` are still exported

- [ ] **Step 6: Final commit (if any fixups needed)**

```bash
git add -A && git commit -m "chore(event-processor): final verification fixups"
```
