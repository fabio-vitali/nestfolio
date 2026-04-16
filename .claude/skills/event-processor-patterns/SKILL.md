---
name: event-processor-patterns
description: Reference for event-processor pipeline types, handler signatures, WriteIntent types, and testing utilities. Use when implementing or reviewing Lambda handlers that use the event-processor library.
---

# Event-Processor Patterns

## When This Skill Applies

Use this skill whenever you are:
- Implementing a Lambda handler that processes SQS, DynamoDB Stream, or Kinesis events
- Writing ingestion (materialize) or egestion (CDC / replay) pipelines
- Choosing the right pipeline type for a new handler
- Writing tests for event-processor-based handlers

All Lambda handlers in this project MUST use event-processor pipelines (except Step Functions task handlers, which use `resumeStateMachine`).

---

## Pipeline Types

There are 6 pipeline factory functions. Import from `@nestfolio/event-processor`.

### 1. `materializeToTable` — SQS/Kinesis → DynamoDB

Ingestion pipeline. Reads domain events from SQS (or Kinesis) and writes items to DynamoDB via WriteIntents.

**Import:**
```ts
import { materializeToTable } from '@nestfolio/event-processor';
```

**Config shape:**
```ts
interface MaterializeToTableConfig {
  serviceName: string;
  handlers: Record<string, HandlerEntry>;
  table?: string;          // default: process.env.TABLE_NAME
  bus?: string;            // default: process.env.BUS_NAME
  concurrency?: number;
  poisonPill?: { maxReceiveCount: number };
  errorEventType?: string;
  transport?: 'sqs' | 'kinesis';  // default: 'sqs'
}
```

**Usage:**
```ts
export const handler = materializeToTable({
  serviceName: 'execution-ctrl',
  handlers: {
    'Order.Created': async (payload, ctx) => {
      return record('Order', { ...payload.subject, tenantId: ctx.tenantId });
    },
  },
});
// Returns: (event: SQSEvent, context?: Context) => Promise<SQSBatchResponse>
// With transport: 'kinesis' → (event: KinesisStreamEvent) => Promise<KinesisStreamBatchResponse>
```

**Source:** `libs/event-processor/src/pipelines/materialize-to-table.ts`

---

### 2. `materializeToBucket` — SQS → S3

Ingestion pipeline for export/archival use cases. Writes to S3 via `StoreIntent`.

**Import:**
```ts
import { materializeToBucket } from '@nestfolio/event-processor';
```

**Config shape:**
```ts
interface MaterializeToBucketConfig {
  serviceName: string;
  handlers: Record<string, HandlerEntry>;
  bucket?: string;           // default: process.env.EXPORT_BUCKET
  bus?: string;
  concurrency?: number;
  poisonPill?: { maxReceiveCount: number };
  defaultFormat?: 'json' | 'csv';
}
```

**Usage:**
```ts
export const handler = materializeToBucket({
  serviceName: 'reporting-svc',
  handlers: {
    'Report.Generated': async (payload) => {
      return store(payload.subject, { format: 'json' });
    },
  },
});
// Returns: (event: SQSEvent, context?: Context) => Promise<SQSBatchResponse>
```

**Source:** `libs/event-processor/src/pipelines/materialize-to-bucket.ts`

---

### 3. `changeDataCapture` — DynamoDB Stream → EventBridge

Egestion pipeline. Reads DynamoDB Stream records, maps them to event types, and publishes to EventBridge.

**Import:**
```ts
import { changeDataCapture } from '@nestfolio/event-processor';
```

**Config shape:**
```ts
interface ChangeDataCaptureConfig {
  groupBy?: {
    key: (record: StreamRecord) => string;
    pick?: 'first' | 'last';
  };
  bus?: string;              // default: process.env.BUS_NAME
  concurrency?: number;
  transform?: (record: StreamRecord, eventType: string) => Record<string, unknown>;
}
```

> **Note:** `serviceName` and event-type mapping are NOT passed in config — they are read from environment variables (`SERVICE_NAME`, `EVENT_TYPE_MAP`) injected by the CDK Egress construct. The `eventTypes` map is defined declaratively on the Egress construct in `service.stack.ts`, not in the handler.

**Usage:**
```ts
// Handler is a thin 2-line stub — all config comes from CDK Egress construct
export const handler = changeDataCapture();
// Returns: (event: DynamoDBStreamEvent) => Promise<void>

// Optional: with groupBy deduplication
export const handler = changeDataCapture({
  groupBy: { key: (r) => r.pk, pick: 'last' },
});
```

**CDK side (service.stack.ts) — this is where event types are configured:**
```ts
const egress = new Egress(this, 'Egress', {
  state,
  eventTypes: {
    'Order': { insert: 'ORDER_CREATED', modify: 'ORDER_UPDATED' },
    'Trade': { insert: 'TRADE_EXECUTED' },
  },
});
```

The Egress construct serializes `eventTypes` into the `EVENT_TYPE_MAP` env var, which the CDC pipeline reads at runtime.

**Source:** `libs/event-processor/src/pipelines/change-data-capture.ts`

---

### 4. `resumeStateMachine` — SQS → Step Functions task token

Ingestion pipeline for events that carry a Step Functions task token. Automatically calls `SendTaskSuccess` or `SendTaskFailure`.

**Import:**
```ts
import { resumeStateMachine } from '@nestfolio/event-processor';
```

**Config shape:**
```ts
interface ResumeStateMachineConfig {
  serviceName: string;
  handlers: Record<string, ResumeHandler>;
  table?: string;
  bus?: string;
  errorEventType?: string;
}

type ResumeHandler = (
  payload: EventPayload,
  ctx: EventContext,
) => Promise<{ output: Record<string, unknown>; intents?: WriteIntent[] }>;
```

**Usage:**
```ts
export const handler = resumeStateMachine({
  serviceName: 'broker-ctrl',
  handlers: {
    'BrokerOrder.Filled': async (payload, ctx) => {
      return {
        output: { fillPrice: payload.subject.fillPrice },
        intents: [
          update('BrokerOrder', { status: 'filled' }, { overrides: { pk: ctx.tenantId } }),
        ],
      };
    },
  },
});
// Returns: (event: SQSEvent, context?: Context) => Promise<SQSBatchResponse>
// The task token is read from payload.subject.taskToken automatically.
```

**Source:** `libs/event-processor/src/pipelines/resume-state-machine.ts`

---

### 5. `replayAndReduce` — DynamoDB Stream → Snapshot

Egestion pipeline. On each stream trigger, queries all events for a group since last checkpoint, reduces them into a snapshot, and persists with optimistic concurrency. Supports optional daily snapshots.

**Import:**
```ts
import { replayAndReduce } from '@nestfolio/event-processor';
```

**Config shape:**
```ts
interface ReplayAndReduceConfig<S> {
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
  /** Required — no default convention query. */
  queryEvents: (
    groupKey: string,
    lastSequence: number,
    clients: { docClient: DynamoDBDocumentClient; tableName: string },
  ) => Promise<Record<string, unknown>[]>;
  /** Required — extract RequestContext from the group key and stream records. */
  requestContext: (groupKey: string, records: StreamRecord[]) => RequestContext;
  /** Optional — custom save logic. Replaces the default optimistic-lock PutCommand. */
  saveSnapshot?: (params: {
    snapshotKey: { pk: string; sk: string };
    state: S;
    lastEventSequence: number;
    version: number;
    requestContext: RequestContext;
    clients: { docClient: DynamoDBDocumentClient; tableName: string };
  }) => Promise<void>;
  table?: string;
  bus?: string;
  concurrency?: number;
}
```

**Usage:**
```ts
export const handler = replayAndReduce<PortfolioState>({
  serviceName: 'portfolio-svc',
  groupBy: { key: (r) => r.pk },
  reducer: (state, event) => applyEvent(state, event),
  initialState: () => ({ positions: {}, cash: 0 }),
  snapshot: {
    key: (groupKey) => ({ pk: groupKey, sk: 'Snapshot#current' }),
    daily: true,
  },
});
// Returns: (event: DynamoDBStreamEvent) => Promise<void>
```

**Source:** `libs/event-processor/src/pipelines/replay-and-reduce.ts`

---

### 6. `deriveFromStream` — DynamoDB Stream → DynamoDB (write-back)

Egestion pipeline. Reads DynamoDB Stream records, transforms them into WriteIntents, and writes derived items back to the same table via the IntentExecutor. Use for computed/denormalized records that should be materialized whenever a source record changes.

**Import:**
```ts
import { deriveFromStream } from '@nestfolio/event-processor';
```

**Config shape:**
```ts
interface DeriveFromStreamConfig {
  serviceName: string;
  /** Filter stream records (e.g., by __typename). */
  filter?: (record: StreamRecord) => boolean;
  /**
   * Transform a stream record into WriteIntents.
   * `previous` is the OldImage (undefined on INSERT).
   */
  transform: (
    current: StreamRecord,
    previous: StreamRecord | undefined,
    ctx: StreamContext,
  ) => WriteIntent[] | Promise<WriteIntent[]>;
  table?: string;
  bus?: string;
  concurrency?: number;
  errorEventType?: string;
}
```

**Usage:**
```ts
export const handler = deriveFromStream({
  serviceName: 'portfolio-ctrl',
  filter: (r) => r.__typename === 'Position',
  transform: (current, previous, ctx) => {
    const qty = (current.quantity as number) ?? 0;
    const prevQty = (previous?.quantity as number) ?? 0;
    const delta = qty - prevQty;
    return [
      accumulate('PortfolioSummary', { field: 'totalPositions', increment: delta }),
    ];
  },
});
// Returns: (event: DynamoDBStreamEvent) => Promise<void>
```

**Source:** `libs/event-processor/src/pipelines/derive-from-stream.ts`

---

## Handler Signature

All `materializeToTable` and `materializeToBucket` handlers use `HandlerEntry`:

```ts
// From: libs/event-processor/src/types/handler-config.ts

export interface EventPayload {
  readonly subject: Record<string, unknown>;
  readonly context?: Record<string, unknown>;
}

export type HandlerFn = (
  payload: EventPayload,
  ctx: EventContext,
) => WriteIntent | WriteIntent[] | Promise<WriteIntent | WriteIntent[]>;

// A HandlerEntry is either a single function or an array of functions/intents (multi-write)
export type HandlerEntry = HandlerFn | Array<HandlerFn | WriteIntent>;
```

`EventContext` carries: `eventId`, `eventType`, `tenantId`, `userId`, `region`, `timestamp`, `receiveCount`, `serviceName`, `record` (raw SQS record).

---

## WriteIntent Types

Returned from handlers to declare what the engine should write. Import builder functions from `@nestfolio/event-processor`.

| Intent | Tag | Builder | Key Fields |
|--------|-----|---------|------------|
| `RecordIntent` | `'record'` | `record(typename, fields, overrides?)` | `typename`, `fields`, `overrides?` |
| `ProjectIntent` | `'project'` | `project(typename, fields, overrides?)` | `typename`, `fields`, `overrides?` |
| `AccumulateIntent` | `'accumulate'` | `accumulate(typename, config)` | `typename`, `config: { field, increment, ttl?, overrides? }` |
| `UpdateIntent` | `'update'` | `update(typename, updates, opts?)` | `typename`, `updates`, `removes?`, `condition?`, `overrides?` |
| `StoreIntent` | `'store'` | `store(body, opts?)` | `body`, `format?` (`'json'\|'csv'`), `key?` |
| `SkipIntent` | `'skip'` | `skip()` | — |

**KeyOverrides** (`overrides` param): `{ pk?: string; sk?: string }` — override the computed DynamoDB key.

**`record` builder overloads:**
```ts
// Static fields → returns RecordIntent directly
record('Order', { orderId: '123', status: 'open' })

// Dynamic fields → returns HandlerFn (called with payload+ctx)
record('Order', (payload, ctx) => ({ ...payload.subject, tenantId: ctx.tenantId }))
```

**`accumulate` builder:**
```ts
// Config object with field, increment, and optional ttl/overrides
accumulate('PortfolioSummary', { field: 'totalPositions', increment: 1 })
accumulate('PortfolioSummary', { field: 'totalPositions', increment: -1, ttl: 86400, overrides: { pk: `T#${tenantId}` } })
```

**`project` builder overloads:**
```ts
// Static fields → returns ProjectIntent directly
project('OrderView', { orderId: '123', status: 'open' })

// Dynamic fields → returns HandlerFn (called with payload+ctx)
project('OrderView', (payload, ctx) => ({ ...payload.subject, tenantId: ctx.tenantId }))
```

**`update` builder:**
```ts
update('Order', { status: 'filled', filledAt: new Date().toISOString() }, {
  removes: ['pendingField'],
  condition: 'attribute_exists(pk)',
  overrides: { pk: `T#${tenantId}` },
})
```

**`normalizedEvent` builder (type-safe NormalizedEvent writes):**
```ts
import { normalizedEvent } from '@nestfolio/event-processor';

normalizedEvent({
  tenantId: ctx.tenantId,
  userId: ctx.userId,
  region: ctx.region,
  timestamp: ctx.timestamp,
  amount: subject.amount,
}, {
  pk: `NormalizedEvent#${ctx.tenantId}#${orderId}`,
  sk: 'ORDER_FILLED',
})
```

### NormalizedEvent and RequestContext — CRITICAL

NormalizedEvent records trigger CDC passthrough events. The CDC `buildEntry` function reads `tenantId`, `userId`, and `region` from the DDB record and puts them in the EventBridge event `context`. Downstream Ingress pipelines validate all three fields via `RequestContextSchema`. **Missing fields cause silent event drops** (`Invalid event: missing "context.X" field`).

**ALWAYS use `normalizedEvent()` instead of `record('NormalizedEvent', ...)` in Lambda handlers.** The `normalizedEvent()` intent requires `RequestContext` fields (`tenantId`, `userId`, `region`) at compile time — if you forget one, the build fails.

**For repositories** that write NormalizedEvent (e.g., `CircuitBreakerRepository.writeBreakerOpenEvent`): accept `RequestContext` as a parameter and spread it into the record. This propagates any future RequestContext field additions.

```ts
// ✅ Correct — RequestContext enforced at compile time
readonly writeBreakerOpenEvent = async (context: RequestContext, adapterId: string) => {
  await this.put({ pk: ..., sk: ..., __typename: 'NormalizedEvent', ...context, adapter: adapterId });
};

// ❌ Wrong — individual fields, easy to forget one
readonly writeBreakerOpenEvent = async (tenantId: string, adapterId: string) => {
  await this.put({ pk: ..., sk: ..., __typename: 'NormalizedEvent', tenantId, adapter: adapterId });
};
```

**For Step Functions DDB PutItem** (CDK CustomState): always include `tenantId`, `userId`, and `region` from state input. SF definitions are JSON, so TypeScript can't enforce this — add a comment referencing RequestContext.

```ts
// SF DDB PutItem — include all RequestContext fields (tenantId, userId, region)
Item: {
  __typename: { S: 'NormalizedEvent' },
  tenantId: { 'S.$': '$.tenantId' },
  userId: { 'S.$': '$.userId' },    // ← Required by RequestContext
  region: { 'S.$': '$.region' },     // ← Required by RequestContext
  timestamp: { 'S.$': '$$.State.EnteredTime' },
}
```

**Source:** `libs/event-processor/src/types/write-intent.ts`, `libs/event-processor/src/intents/`

---

## Testing

### SQS Pipeline Tests — `createTestHarness`

```ts
import {
  createTestHarness,
  fakeSqsRecord,
} from '@nestfolio/event-processor/testing';
import { myHandlers } from '../src/handlers';

const harness = createTestHarness({
  serviceName: 'execution-ctrl',
  handlers: myHandlers,
});

it('records an order on Order.Created', async () => {
  const record = fakeSqsRecord('Order.Created', {
    orderId: 'order-1',
    symbol: 'AAPL',
    quantity: 10,
  });

  const result = await harness.process([record]);

  expect(result.intents).toEqual([
    expect.objectContaining({ _tag: 'record', typename: 'Order' }),
  ]);
  expect(result.errors).toHaveLength(0);
});
```

`TestResult` fields: `intents`, `metrics`, `errors`, `batchItemFailures`, `deduplicated`, `poisonPills`, `skipped`.

---

### DynamoDB Stream Tests — `createCdcTestHarness` / `createReducerTestHarness`

```ts
import {
  createCdcTestHarness,
  createReducerTestHarness,
  fakeDdbStreamRecord,
} from '@nestfolio/event-processor/testing';

// CDC test — eventTypeMap is injected via process.env.EVENT_TYPE_MAP
const cdcHarness = createCdcTestHarness({
  serviceName: 'execution-ctrl',
});

it('publishes Order.Created on INSERT', async () => {
  const ddbRecord = fakeDdbStreamRecord('INSERT', {
    __typename: 'Order',
    pk: 'T#tenant-1',
    sk: 'Order#order-1',
    tenantId: 'tenant-1',
    orderId: 'order-1',
  });

  const result = await cdcHarness.process([ddbRecord]);

  expect(result.publishedEvents).toEqual([
    expect.objectContaining({ eventType: 'Order.Created' }),
  ]);
});
```

`fakeDdbStreamRecord(eventName, newImage, opts?)` — opts: `oldImage`, `typename`, `tenantId`, `userId`, `region`, `sequenceNo`.

**Reducer test with seeding:**
```ts
const reducerHarness = createReducerTestHarness<MyState>({
  serviceName: 'portfolio-svc',
  groupBy: { key: (r) => r.pk },
  reducer: myReducer,
  initialState: () => ({ positions: {} }),
  snapshot: { key: (gk) => ({ pk: gk, sk: 'Snapshot#current' }) },
});

reducerHarness.seedSnapshot('T#tenant-1', { positions: {} }, 0, 0);
reducerHarness.seedEvents('T#tenant-1', [{ sequenceNo: 1, symbol: 'AAPL', quantity: 10 }]);

const result = await reducerHarness.process([fakeDdbStreamRecord('INSERT', { pk: 'T#tenant-1', sk: 'Trade#1', __typename: 'Trade', tenantId: 'tenant-1' })]);

expect(result.snapshots.get('T#tenant-1')?.version).toBe(1);
```

---

### Kinesis Records

`fakeKinesisRecord` exists in `libs/event-processor/src/testing/fake-records.ts` but is **not publicly exported**. If needed for Kinesis pipeline tests, import it directly:

```ts
import { fakeKinesisRecord } from '@nestfolio/event-processor/testing/fake-records';

const kRecord = fakeKinesisRecord('Order.Created', { orderId: '123' }, {
  tenantId: 'tenant-1',
});
```

> **Public testing exports** from `@nestfolio/event-processor`: `createTestHarness`, `fakeSqsRecord`, `fakeDdbStreamRecord`.

---

## Anti-Patterns

- **Never** call another service's API from a handler — use events only.
- **Never** use raw `DynamoDBClient` or `SQSClient` inside a `HandlerFn` — return WriteIntents and let the engine write.
- **Never** import `aws-lambda` handler types directly into the service — the pipeline factory returns the correctly typed Lambda handler.
- **Never** return `undefined` from a handler — return `skip()` if there is nothing to write.
- **Never** put a handler directly on a `materializeToTable` config that should be using `resumeStateMachine` — task token handling requires the dedicated pipeline.
- **Never** write tests against the live Lambda handler function — use `createTestHarness` / `createCdcTestHarness` / `createReducerTestHarness` to isolate handler logic.
- **Avoid** `HandlerEntry` arrays unless you genuinely need multi-write fan-out; prefer returning `WriteIntent[]` from a single `HandlerFn` instead.

---

## Step Functions — CDK CustomState Error Handling

When building Step Functions with `CustomState`, always use `.addCatch()` for error handling. Never use raw JSON `Catch` with `Next` string references in `stateJson`. CDK cannot resolve raw string references to state graph nodes — catch targets will be excluded from the rendered ASL by `DefinitionBody.fromChainable()`.

```typescript
// CORRECT
myTask.addCatch(errorHandler, { errors: ['States.Timeout'], resultPath: '$.error' });
```
