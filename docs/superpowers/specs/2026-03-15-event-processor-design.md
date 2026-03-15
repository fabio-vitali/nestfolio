# @nestfolio/event-processor — Design Specification

## Overview

A declarative, convention-over-configuration event processing framework for AWS Lambda. It provides transparent idempotency, parallelism with backpressure, per-record error collection, and pre-configured pipelines for common event-driven / event-sourcing patterns.

This library is a **core piece** of the nestfolio architecture. Every event-processing Lambda (SQS listeners, DDB Stream handlers) should use it.

### Design Principles

1. **Declarative** — handlers express *what* to do (intent helpers), not *how* (DDB API calls)
2. **Convention over configuration** — pk/sk, guard keys, metrics derived from conventions; overrides available but rarely needed
3. **Transparent guards** — idempotency strategy is embedded in the intent type; impossible to forget
4. **Per-record error isolation** — errors never block the batch; collected and classified post-batch (Highland-style)
5. **Store-then-CDC** — SQS handlers only write to DDB/S3; event publishing is exclusively via DDB Stream → CDC handlers
6. **Performant** — concurrency-limited parallel execution via p-limit; groupBy deduplication within batches

### Anti-Patterns Enforced

- **No direct EventBridge publish from SQS handlers** — use CDC instead (durability guarantee)
- **No unguarded writes** — every intent has a built-in idempotency strategy
- **No manual error handling loops** — the framework handles try/catch per record
- **No manual metrics/tracing** — automatic per-record and per-batch instrumentation

---

## Architecture

### Library Structure

```
libs/event-processor/
├── src/
│   ├── engine/
│   │   ├── base-collector.ts        # Shared outcome collection (success, error, metrics)
│   │   ├── batch-engine.ts          # Core SQS batch loop
│   │   ├── stream-engine.ts         # Core DDB Stream loop
│   │   ├── error-collector.ts       # SQS-specific collector (extends BaseCollector)
│   │   ├── stream-collector.ts      # DDB Stream-specific collector (extends BaseCollector)
│   │   ├── error-event-publisher.ts # Shared fire-and-forget error event publishing
│   │   ├── intent-executor.ts       # WriteIntent → AWS SDK calls (SQS only)
│   │   └── normalize-handler.ts     # Handler normalization (SQS only)
│   ├── intents/
│   │   ├── record.ts                # record() helper
│   │   ├── project.ts               # project() helper
│   │   ├── accumulate.ts            # accumulate() helper
│   │   ├── s3-put.ts                # s3Put() helper
│   │   ├── skip.ts                  # skip() helper
│   │   └── types.ts                 # WriteIntent union type
│   ├── pipelines/
│   │   ├── create-event-handler.ts  # SQS universal factory
│   │   ├── materialize-to-table.ts  # SQS → DDB preset
│   │   ├── materialize-to-bucket.ts # SQS → S3 preset
│   │   ├── create-stream-handler.ts # DDB Stream universal factory
│   │   ├── change-data-capture.ts   # DDB Stream → EventBridge preset
│   │   └── replay-and-reduce.ts     # DDB Stream → group → reduce → snapshot
│   ├── types/
│   │   ├── write-intent.ts          # WriteIntent union type
│   │   ├── handler-config.ts        # HandlerFn, HandlerEntry, EventPayload
│   │   ├── event-context.ts         # EventContext for SQS handlers
│   │   ├── stream-types.ts          # StreamRecord, StreamContext for DDB Stream handlers
│   │   └── result-types.ts          # RecordResult, IntentResult, BatchResult
│   ├── util/
│   │   ├── async-pool.ts            # p-limit based concurrency
│   │   ├── group-by.ts              # Batch grouping + pick strategy
│   │   ├── fork-merge.ts            # Parallel branch execution
│   │   ├── csv-serializer.ts        # Array-of-objects → CSV
│   │   ├── event-bridge-publisher.ts # CDC batch publish with retry (internal)
│   │   └── unmarshal-stream.ts      # DDB record → StreamRecord + StreamContext
│   ├── testing/
│   │   ├── test-harness.ts          # createTestHarness(), createStreamTestHarness(), etc.
│   │   └── fake-records.ts          # fakeSqsRecord(), fakeDdbStreamRecord()
│   └── index.ts
├── jest.config.ts
├── tsconfig.json
├── tsconfig.lib.json
├── tsconfig.spec.json
└── project.json
```

### Dependency Graph

```
@nestfolio/event-processor
  ├── p-limit (concurrency semaphore, ~1 KB)
  ├── @aws-sdk/lib-dynamodb (DDB writes)
  ├── @aws-sdk/client-s3 (S3 writes, only for materializeToBucket)
  ├── @aws-sdk/client-eventbridge (error event publishing + CDC)
  └── @nestfolio/lambda-utils (logger, metrics, traceEvent, isRetryable, NotRetryableError)
```

Note: `@nestfolio/platform-core` is NOT a dependency. The framework owns its own DDB write logic (intent executor), independent of TableRepository. Services that use event-processor do NOT extend TableRepository for event-driven writes — the framework replaces that pattern.

---

## Core Types

### WriteIntent

All intent helpers return plain data objects — no functions, no closures. Intents are serializable and assertable in tests.

```typescript
interface RecordIntent {
  readonly _tag: 'record';
  readonly typename: string;
  readonly fields: Record<string, unknown>;
  readonly overrides?: KeyOverrides;
}

interface ProjectIntent {
  readonly _tag: 'project';
  readonly typename: string;
  readonly fields: Record<string, unknown>;
  readonly overrides?: KeyOverrides;
}

interface AccumulateIntent {
  readonly _tag: 'accumulate';
  readonly typename: string;
  readonly field: string;
  readonly increment: number;
  readonly ttl?: number;             // default: 86400 (24h); use 604800 for financial ops
  readonly overrides?: KeyOverrides;
}

interface S3PutIntent {
  readonly _tag: 's3-put';
  readonly body: unknown;
  readonly format: 'json' | 'csv';
  readonly key?: string;             // override auto-derived key
}

interface SkipIntent {
  readonly _tag: 'skip';
}

type WriteIntent = RecordIntent | ProjectIntent | AccumulateIntent | S3PutIntent | SkipIntent;

interface KeyOverrides {
  pk?: string;   // override convention pk
  sk?: string;   // override convention sk
}
```

### Intent Helpers

```typescript
function record(typename: string, fields: Record<string, unknown>, overrides?: KeyOverrides): RecordIntent;
function project(typename: string, fields: Record<string, unknown>, overrides?: KeyOverrides): ProjectIntent;
function accumulate(typename: string, config: { field: string; increment: number; ttl?: number; overrides?: KeyOverrides }): AccumulateIntent;
function s3Put(body: unknown, opts?: { format?: 'json' | 'csv'; key?: string }): S3PutIntent;
function skip(): SkipIntent;
```

All helpers are pure functions that return data. They perform zero I/O.

### Key Conventions

| Intent | pk | sk | Strategy |
|--------|----|----|----------|
| `record` | `T#${tenantId}` | `${typename}#${eventId}` | putIfNotExists |
| `project` | `T#${tenantId}` | `${typename}` (singleton, last-writer-wins) | upsert (PUT) |
| `accumulate` | `T#${tenantId}` | `${typename}` (singleton) | guardedWrite (guard: pk + `ProcessedEvent#${eventId}`) |

Overrides: pass `{ pk, sk }` to override any convention. The override is the full key value, not a template.

**Intent executor contract:** The intent executor receives both the `WriteIntent` and the `EventContext`. It uses `ctx.eventId` and `ctx.tenantId` to derive conventional keys. The intent itself carries only business data and optional overrides — it does NOT carry `eventId` or `tenantId`. This keeps intents as pure, serializable data.

```typescript
// Intent executor signature (internal)
async function executeIntent(
  intent: WriteIntent,
  ctx: EventContext,        // provides eventId, tenantId for key derivation
  clients: { table: DocClient; s3?: S3Client },
): Promise<IntentResult>;

// Example: accumulate intent execution
// Intent: { _tag: 'accumulate', typename: 'Stats', field: 'tradesCount', increment: 1 }
// Derived: pk = `T#${ctx.tenantId}`, sk = 'Stats'
// Guard:   pk = `T#${ctx.tenantId}`, sk = `ProcessedEvent#${ctx.eventId}`
// → calls guardedWrite(docClient, tableName, guardKey, [{ Update: ... }])
```

### EventContext

```typescript
interface EventContext {
  readonly eventId: string;
  readonly eventType: string;
  readonly tenantId: string;
  readonly userId?: string;
  readonly timestamp: string;
  readonly receiveCount: number;    // SQS ApproximateReceiveCount
  readonly serviceName: string;
  readonly record: SQSRecord;       // escape hatch for raw access
}
```

### StreamRecord

The unmarshalled DDB stream record image, with conventional fields.

```typescript
interface StreamRecord {
  readonly pk: string;
  readonly sk: string;
  readonly __typename: string;
  readonly tenantId: string;
  readonly sequenceNo?: number;        // Convention: monotonic sequence for ordering in replayAndReduce
  readonly [key: string]: unknown;     // remaining entity fields
}
```

The framework unmarshals `NewImage` (or `OldImage` for REMOVE) into a `StreamRecord`. The `sequenceNo` field is a convention used by `replayAndReduce` to sort events within a group before applying the reducer. Services that use `replayAndReduce` must include `sequenceNo` on their DDB records.

### StreamContext

```typescript
interface StreamContext {
  readonly serviceName: string;
  readonly record: DynamoDBRecord;  // escape hatch
  readonly eventName: 'INSERT' | 'MODIFY' | 'REMOVE';
  readonly keys: { pk: string; sk: string };
  readonly typename: string;        // from NewImage.__typename (INSERT/MODIFY) or OldImage.__typename (REMOVE)
  readonly tenantId: string;        // from NewImage.tenantId (INSERT/MODIFY) or OldImage.tenantId (REMOVE)
  readonly newImage?: Record<string, unknown>;   // undefined for REMOVE
  readonly oldImage?: Record<string, unknown>;   // undefined for INSERT (unless stream is NEW_AND_OLD_IMAGES)
}
```

### EventPayload

The event envelope passed to handlers. Mirrors the EventBridge detail structure.

```typescript
interface EventPayload {
  readonly subject: Record<string, unknown>;   // business data
  readonly context?: Record<string, unknown>;  // optional domain context (tenantId, userId, etc.)
}
```

### Handler Config

#### HandlerFn

Every handler entry is a function that receives the event payload and context, and returns intent(s).

```typescript
type HandlerFn = (payload: EventPayload, ctx: EventContext) => WriteIntent | WriteIntent[] | Promise<WriteIntent | WriteIntent[]>;
```

#### HandlerEntry

A handler entry in the config map is one of:

```typescript
type HandlerEntry =
  | HandlerFn                // single handler function (sync or async)
  | HandlerFn[];             // array of handler functions (multi-write, results merged)
```

When `HandlerEntry` is an array of `HandlerFn`, the engine calls each function and flattens the returned intents into a single array. This is how multi-write events work:

```typescript
// Array of HandlerFn — each returns intent(s), results merged
ORDER_FILLED: [
  record('Activity', ({ subject }) => ({ description: `Filled ${subject.symbol}` })),
  accumulate('Stats', { field: 'tradesCount', increment: 1 }),
]
// record(..., mapper) returns a HandlerFn, accumulate(..., static) returns a HandlerFn
// Engine calls both, merges: [RecordIntent, AccumulateIntent]
```

#### Intent Helpers — Two Modes

All intent helpers (`record`, `project`, `accumulate`) are overloaded to work in two contexts:

**Mapper mode** (standalone — returns `HandlerFn`):

Used as a direct handler entry. The mapper function is called by the engine with `(payload, ctx)`.

```typescript
DEPOSIT_DETECTED: record('LedgerEntry', ({ subject }) => ({
  amount: subject.amount, currency: subject.currency,
}))
// record(typename, mapper) returns HandlerFn
```

**Inline mode** (inside an async handler — returns `WriteIntent` data):

Used inside an async `HandlerFn` where the payload is already destructured.

```typescript
ORDER_FILLED: async ({ subject }, ctx) => [
  record('LedgerEntry', { amount: subject.filledQty * subject.price }),
  accumulate('Stats', { field: 'tradesCount', increment: 1 }),
]
// record(typename, fields) returns RecordIntent (plain data)
// accumulate(typename, config) returns AccumulateIntent (plain data)
```

**Overloaded signatures:**

```typescript
// record: mapper mode → HandlerFn, inline mode → RecordIntent
function record(typename: string, mapper: (payload: EventPayload, ctx: EventContext) => Record<string, unknown>, overrides?: KeyOverrides): HandlerFn;
function record(typename: string, fields: Record<string, unknown>, overrides?: KeyOverrides): RecordIntent;

// project: same pattern
function project(typename: string, mapper: (payload: EventPayload, ctx: EventContext) => Record<string, unknown>, overrides?: KeyOverrides): HandlerFn;
function project(typename: string, fields: Record<string, unknown>, overrides?: KeyOverrides): ProjectIntent;

// accumulate: mapper mode wraps increment computation in HandlerFn
function accumulate(typename: string, config: { field: string; increment: number; ttl?: number }): AccumulateIntent;
```

**Discrimination:** The second argument's type determines the mode. If it's a function → mapper mode (returns `HandlerFn`). If it's a plain object/record → inline mode (returns intent data). TypeScript discriminates via overloads at compile time.

**Note on `accumulate`:** `accumulate` only has an inline mode (returns `AccumulateIntent`). For dynamic increments, use the async handler form where you have access to `subject`:

```typescript
DEPOSIT_INITIATED: async ({ subject }, ctx) => [
  accumulate('CashBalance', { field: 'balance', increment: subject.amount, ttl: 604800 }),
]
```

**Note on mixing intents in `HandlerFn[]` arrays:** When a handler entry is an array (multi-write), the engine accepts both `HandlerFn` and `WriteIntent` elements. Mapper-mode helpers (e.g., `record(typename, mapper)`) return `HandlerFn`; inline-mode helpers (e.g., `accumulate(typename, config)`) return `WriteIntent`. The engine normalizes: if the element is a function, it calls it with `(payload, ctx)`; if it's a data object with `_tag`, it uses it directly.

```typescript
// Mixed array — engine handles both forms:
ORDER_FILLED: [
  record('Activity', ({ subject }) => ({ ... })),  // HandlerFn (mapper mode)
  accumulate('Stats', { field: 'tradesCount', increment: 1 }),  // AccumulateIntent (inline mode)
]
```

---

## SQS Pipelines

### `createEventHandler` (universal)

The base factory for all SQS event listeners. Named presets are sugar over this.

```typescript
interface EventHandlerConfig {
  serviceName: string;
  handlers: Record<string, HandlerEntry>;
  // Clients (injected or auto-created from env vars)
  table?: string | { name: string; client: DynamoDBDocumentClient };
  bus?: string | { name: string; client: EventBridgeClient };
  s3?: { bucket: string; client?: S3Client };
  // Tuning
  concurrency?: number;          // default: 5 (parallel records). Use 1 for services with ordering dependencies.
  poisonPill?: {
    maxReceiveCount: number;     // default: 5
  };
  errorEventType?: string;       // default: `${SCREAMING_SNAKE(serviceName)}_FAILED`
}

function createEventHandler(config: EventHandlerConfig):
  (event: SQSEvent, context?: Context) => Promise<SQSBatchResponse>;
```

When `table` or `bus` is a string, the framework creates clients from environment defaults. When an object, the provided client is used (useful for testing or custom config).

### `materializeToTable` (preset)

Sugar for the most common case: SQS → DDB writes.

```typescript
interface MaterializeToTableConfig {
  serviceName: string;
  handlers: Record<string, HandlerEntry>;
  table?: string;         // default: process.env.TABLE_NAME
  bus?: string;           // default: process.env.BUS_NAME (for error events)
  concurrency?: number;
  poisonPill?: { maxReceiveCount: number };
}

function materializeToTable(config: MaterializeToTableConfig):
  (event: SQSEvent, context?: Context) => Promise<SQSBatchResponse>;
```

Convention: `table` defaults to `process.env.TABLE_NAME`, `bus` defaults to `process.env.BUS_NAME`. Most services need zero client config.

### `materializeToBucket` (preset)

SQS → S3 writes. Handlers use `s3Put()` intents.

```typescript
interface MaterializeToBucketConfig {
  serviceName: string;
  handlers: Record<string, HandlerEntry>;  // handlers return s3Put() intents
  bucket?: string;        // default: process.env.EXPORT_BUCKET
  bus?: string;           // default: process.env.BUS_NAME
  concurrency?: number;
  poisonPill?: { maxReceiveCount: number };
  defaultFormat?: 'json' | 'csv';   // default: 'json'
}

function materializeToBucket(config: MaterializeToBucketConfig):
  (event: SQSEvent, context?: Context) => Promise<SQSBatchResponse>;
```

Key convention for S3: `{tenantId}/{typename}/{eventId}.{format}`

Handlers return `s3Put()` intents, same as any other pipeline:
```typescript
// Handler returns s3Put intent — same HandlerEntry type as all pipelines
PORTFOLIO_SNAPSHOT_REQUESTED: async ({ subject }, ctx) => [
  s3Put({ positions: subject.positions, asOf: subject.timestamp }, { format: 'json' }),
],
```

---

## DDB Stream Pipelines

### `createStreamHandler` (universal)

The base factory for all DDB Stream handlers.

```typescript
interface StreamHandlerConfig {
  serviceName: string;
  processRecord?: (record: StreamRecord, ctx: StreamContext) => Promise<void>;
  // OR
  processGroup?: (groupKey: string, records: StreamRecord[], ctx: StreamContext) => Promise<void>;
  groupBy?: {
    key: (record: StreamRecord) => string;
    pick?: 'first' | 'last' | 'all';  // default: 'all'
  };
  filter?: (record: StreamRecord) => boolean;
  concurrency?: number;          // default: 3
  bus?: string | { name: string; client: EventBridgeClient };
  table?: string | { name: string; client: DynamoDBDocumentClient };
  errorEventType?: string;
}

function createStreamHandler(config: StreamHandlerConfig): (event: DynamoDBStreamEvent) => Promise<void>;
```

Stream handlers return `void` and perform their own I/O (e.g., publish to EventBridge, write snapshots). They do NOT return `WriteIntent[]` — stream-specific patterns (CDC publish with batch retry, snapshot conditional writes) don't map cleanly to the SQS intent system.

### `changeDataCapture` (preset)

DDB Stream → EventBridge. Zero handler code for structural event forwarding.

```typescript
interface ChangeDataCaptureConfig {
  serviceName: string;
  eventTypeMap: Record<string, string | ((record: StreamRecord) => string)>;
  // key format: 'TypeName:INSERT' | 'TypeName:MODIFY' | 'TypeName:REMOVE'
  // value: event type string or function returning event type string
  groupBy?: {
    key: (record: StreamRecord) => string;
    pick?: 'first' | 'last';    // default: 'last'
  };
  bus?: string;                  // default: process.env.BUS_NAME
  concurrency?: number;
  // Optional: transform the record before publishing
  transform?: (record: StreamRecord, eventType: string) => Record<string, unknown>;
}

function changeDataCapture(config: ChangeDataCaptureConfig): (event: DynamoDBStreamEvent) => Promise<void>;
```

Convention: if no `transform`, the full DDB record image is published as the event subject. The `eventTypeMap` key format `TypeName:StreamEventName` matches the existing Egress `customEventTypeMap` convention.

### `replayAndReduce` (preset)

DDB Stream → group → replay events → save snapshot. For event sourcing read models.

```typescript
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
    daily?: boolean;              // default: false — save daily checkpoint too
  };
  // Convention-based query (default) or override for non-standard schemas
  queryEvents?: (groupKey: string, lastSequence: number, clients: {
    docClient: DynamoDBDocumentClient;
    tableName: string;
  }) => Promise<Record<string, unknown>[]>;
  table?: string;                 // default: process.env.TABLE_NAME
  bus?: string;                   // default: process.env.BUS_NAME (for error events)
  concurrency?: number;           // default: 3
}

function replayAndReduce<S>(config: ReplayAndReduceConfig<S>): (event: DynamoDBStreamEvent) => Promise<void>;
```

**Implementation detail — query-since-checkpoint (not delta reduction):**

The DDB Stream batch is used as a **trigger**, not as the data source for reduction. The framework queries all events since the last snapshot checkpoint for resilience against out-of-order delivery and shard splits:

1. Filters records by `filter`
2. Groups by `groupBy.key` (all records in group — order matters for reduction)
3. For each group:
   a. **Loads the current snapshot** from DDB at `snapshot.key(groupKey)` — or uses `initialState` if none exists (initial `version` = 0)
   b. **Queries all events since the last snapshot's `lastEventSequence`** using the convention-based query (pk from record, sk prefix from `__typename`, `sequenceNo > lastSeq`) or the `queryEvents` override
   c. **Sorts queried events by `sequenceNo`** (ascending, defensive even if query uses ScanIndexForward)
   d. **Applies `reducer(state, event)` sequentially** for each queried event
   e. **Saves the snapshot** with a conditional write: `attribute_not_exists(pk) OR version = :expectedVersion` (optimistic concurrency)
   f. If `daily: true`, also saves to `{pk}#Snapshot#{YYYY-MM-DD}` with `attribute_not_exists(pk)` condition
4. If the conditional write fails (concurrent update), the group is classified as a retryable error

**Convention-based query** (default when `queryEvents` is omitted): derives pk from the stream record's `pk`, sk prefix from `__typename`, filters by `sequenceNo > lastSnapshotSequence`. Services with non-standard schemas (e.g., GSI queries) provide `queryEvents` override. Note: the convention query uses the `__typename` of the **first record in the group** — all records in a group should share the same typename. If a group contains mixed typenames, provide `queryEvents`.

**Note:** The `reducer` function must be a pure `(state, event) => state` function. The same reducer is used for both stream-triggered delta updates and full replay (disaster recovery, schema migration via separate batch job).

---

## Batch Engine (Internal)

### Processing Flow

```
SQS Batch Engine (per Lambda invocation)

  ┌──── asyncPool(records, concurrency) ────────────────┐
  │                                                      │
  │  Per record:                                         │
  │                                                      │
  │  1. PARSE                                            │
  │     parseRecord(record) → { event, payload, record } │
  │     ✗ malformed → NotRetryableError → collected      │
  │                                                      │
  │  2. POISON PILL CHECK                                │
  │     receiveCount > maxReceiveCount?                  │
  │     → collect PoisonPill, SKIP                       │
  │                                                      │
  │  3. CONTEXT                                          │
  │     Build EventContext (eventId, tenantId, ...)       │
  │     traceEvent() → X-Ray annotations                 │
  │     logger.info('Processing', { eventType, eventId })│
  │                                                      │
  │  4. ROUTE                                            │
  │     lookup handler by eventType                      │
  │     ✗ unknown → warn + skip (not an error)           │
  │                                                      │
  │  5. EXECUTE HANDLER                                  │
  │     Normalize handler → HandlerEntry                 │
  │     Call handler(payload, ctx) → WriteIntent[]       │
  │                                                      │
  │  6. EXECUTE INTENTS                                  │
  │     For each WriteIntent:                            │
  │       record     → putIfNotExists                    │
  │       project    → put (upsert)                      │
  │       accumulate → guardedWrite                      │
  │       s3-put     → S3 PutObject                      │
  │       skip       → no-op                             │
  │                                                      │
  │     putIfNotExists returns false → deduplicated      │
  │     guardedWrite returns false   → deduplicated      │
  │                                                      │
  │  7. COLLECT OUTCOME                                  │
  │     ✓ success → RecordResult.success                 │
  │     ✓ deduped → RecordResult.deduplicated            │
  │     ✗ error   → RecordResult.error(err, record)      │
  │                                                      │
  └──────────────────────────────────────────────────────┘

  POST-BATCH:

  8. CLASSIFY ERRORS
     retryable       → batchItemFailures (SQS retries)
     non-retryable   → error event to bus (SERVICE_X_FAILED)
     poison pill     → consumed (message deleted from queue, error event published to bus, NOT redriven)

  9. PUBLISH METRICS (single CloudWatch putMetricData call)
     EventProcessed | EventFailed | EventDeduplicated |
     EventDropped | PoisonPillDetected

  10. RETURN SQSBatchResponse
      { batchItemFailures: [{ itemIdentifier: msgId }] }
```

### Error Isolation

Errors are **never thrown** during batch processing. Every record's processing is wrapped:

```typescript
// Pseudocode of the per-record wrapper
async function processRecordSafe(record: SQSRecord, config: Config): Promise<RecordResult> {
  try {
    // steps 1-6
    return { status: 'success', messageId: record.messageId };
  } catch (error) {
    return {
      status: 'error',
      messageId: record.messageId,
      error,
      retryable: isRetryable(error),
    };
  }
}
```

The `asyncPool` executes all records concurrently (up to `concurrency` limit). A failing record does not cancel other in-flight records. After all records complete, the error collector classifies and handles each error.

---

## Concurrency Utilities

### `asyncPool`

Concurrency-limited parallel execution using p-limit.

```typescript
async function asyncPool<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  opts?: { concurrency?: number },  // default: 5
): Promise<R[]>;
```

### `groupBy`

Group items by key with optional pick strategy.

```typescript
// Overloaded for type safety:
function groupBy<T>(items: T[], config: { key: (item: T) => string; pick: 'first' | 'last' }): Map<string, T>;
function groupBy<T>(items: T[], config: { key: (item: T) => string; pick?: 'all' }): Map<string, T[]>;
function groupBy<T>(items: T[], config: { key: (item: T) => string; pick?: 'first' | 'last' | 'all' }): Map<string, T | T[]>;
```

### `forkMerge`

Execute parallel branches with independent filters and concurrency.

```typescript
interface Branch<T, R> {
  filter: (item: T) => boolean;
  process: (item: T) => Promise<R>;
  concurrency?: number;           // default: 5
}

interface BranchResult<R> {
  results: R[];
  errors: Array<{ item: unknown; error: Error }>;
}

async function forkMerge<T, R>(
  items: T[],
  branches: Branch<T, R>[],
): Promise<BranchResult<R>[]>;
```

All three utilities are exported from the library for standalone use outside the engine.

---

## Testing

### Test Harness

The test harness intercepts intent execution and collects results for assertion.

```typescript
interface TestResult {
  intents: WriteIntent[];                       // all intents returned by handlers
  metrics: Record<string, number>;              // EventProcessed, EventFailed, etc.
  errors: Array<{ messageId: string; error: Error; retryable: boolean }>;
  batchItemFailures: string[];                  // message IDs returned to SQS
  deduplicated: number;                         // count of deduped records
  poisonPills: number;                          // count of poison pill records
  skipped: number;                              // count of skipped (unknown type) records
}

function createTestHarness(config: EventHandlerConfig): {
  process: (records: SQSRecord[]) => Promise<TestResult>;
};

// Fake record builders
function fakeSqsRecord(
  eventType: string,
  payload: Record<string, unknown>,
  opts?: { eventId?: string; tenantId?: string; receiveCount?: number },
): SQSRecord;

function fakeDdbStreamRecord(
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE',
  newImage: Record<string, unknown>,
  opts?: { oldImage?: Record<string, unknown> },
): DynamoDBRecord;
```

### What the Harness Does NOT Do

- Does NOT call DynamoDB, S3, or EventBridge
- Does NOT check `putIfNotExists` conditions (that's the framework's job in production)
- DOES validate that intent types match handler declarations
- DOES simulate deduplication when configured (via `simulateDedup: true` option)

---

## Consumer Examples

### Example 1: ledger-ctrl (pure event recording)

```typescript
import { materializeToTable, record } from '@nestfolio/event-processor';

const toLedgerEntry = (mapper: (s: any) => Record<string, unknown>) =>
  record('LedgerEntry', ({ subject }) => mapper(subject));

export const handler = materializeToTable({
  serviceName: 'ledger-ctrl',
  handlers: {
    ORDER_FILLED:            toLedgerEntry(s => ({ amount: s.filledQty * s.price, currency: s.currency, symbol: s.symbol })),
    ORDER_PARTIALLY_FILLED:  toLedgerEntry(s => ({ amount: s.filledQty * s.price, currency: s.currency, symbol: s.symbol })),
    ORDER_REJECTED:          toLedgerEntry(s => ({ orderId: s.orderId, reason: s.reason, type: 'rejection' })),
    ORDER_CANCELLED:         toLedgerEntry(s => ({ orderId: s.orderId, type: 'cancellation' })),
    DEPOSIT_DETECTED:        toLedgerEntry(s => ({ amount: s.amount, currency: s.currency })),
    WITHDRAWAL_COMPLETED:    toLedgerEntry(s => ({ amount: -s.amount, currency: s.currency })),
    CORPORATE_ACTION_PROCESSED: toLedgerEntry(s => ({ action: s.actionType, symbol: s.symbol, adjustment: s.adjustment })),
    DECISION_PACKET_CREATED: toLedgerEntry(s => ({ simulationId: s.simulationId, type: 'simulation' })),
  },
});
```

### Example 2: dashboard-bff (mixed strategies)

```typescript
import { materializeToTable, record, project, accumulate } from '@nestfolio/event-processor';

export const handler = materializeToTable({
  serviceName: 'dashboard-bff',
  handlers: {
    PORTFOLIO_UPDATED:      project('PortfolioSummary', ({ subject }) => ({ totalValue: subject.totalValue, positions: subject.positions })),
    BALANCE_UPDATED:        project('InvestorSnapshot', ({ subject }) => ({ cashBalance: subject.cashBalanceCents })),
    PORTFOLIO_DRIFT_DETECTED: record('Activity', ({ subject }) => ({ description: `Drift: ${subject.driftPct}%`, category: 'alert' })),

    ORDER_FILLED: [
      record('Activity', ({ subject }) => ({ description: `Filled ${subject.symbol} x${subject.qty}`, category: 'trade' })),
      accumulate('Stats', { field: 'tradesCount', increment: 1 }),
    ],

    DECISION_APPROVED: [
      record('Activity', ({ subject }) => ({ description: `Decision ${subject.decisionId} approved`, category: 'advisory' })),
      accumulate('AdvisoryStatus', { field: 'approvedCount', increment: 1, ttl: 604800 }),
    ],
  },
});
```

### Example 3: compliance-ctrl (business logic + store, then CDC publishes)

```typescript
// event-listener.ts
import { materializeToTable, record, project } from '@nestfolio/event-processor';

export const handler = materializeToTable({
  serviceName: 'compliance-ctrl',
  handlers: {
    DECISION_PACKET_CREATED: async ({ subject, context }, ctx) => {
      const result = await ruleEngine.evaluate(subject, context);
      return [record('ComplianceResult', {
        decisionId: subject.decisionId,
        passed: result.passed,
        verdict: result.verdict,
        rules: result.appliedRules,
      })];
    },
    MANDATE_GRANTED:  project('RuleCache', ({ subject }) => ({ rules: subject.rules })),
    MANDATE_UPDATED:  project('RuleCache', ({ subject }) => ({ rules: subject.rules })),
    MANDATE_REVOKED:  project('RuleCache', () => ({ rules: [], revoked: true })),
  },
});

// egress.ts (DDB Stream → EventBridge)
import { changeDataCapture } from '@nestfolio/event-processor';

export const handler = changeDataCapture({
  serviceName: 'compliance-ctrl',
  eventTypeMap: {
    'ComplianceResult:INSERT': (r) => r.passed ? 'DECISION_PACKET_ENRICHED' : 'DECISION_BLOCKED',
  },
  groupBy: {
    key: (r) => `${r.tenantId}#${r.decisionId}`,
    pick: 'last',
  },
});
```

### Example 4: execution-adpt (complex business logic)

```typescript
import { createEventHandler, record, accumulate } from '@nestfolio/event-processor';

export const handler = createEventHandler({
  serviceName: 'execution-adpt',
  handlers: {
    ORDER_SUBMITTED: async ({ subject }, ctx) => {
      const result = await simulationEngine.execute(subject);
      return [
        record('TradeRecord', { orderId: subject.orderId, symbol: subject.symbol, ...result }),
        accumulate('CashBalance', { field: 'balance', increment: -result.totalCost, ttl: 604800 }),
      ];
    },

    DEPOSIT_INITIATED: async ({ subject }, ctx) => [
      accumulate('CashBalance', { field: 'balance', increment: subject.amount, ttl: 604800 }),
    ],

    WITHDRAWAL_REQUESTED: async ({ subject }, ctx) => [
      accumulate('CashBalance', { field: 'balance', increment: -subject.amount, ttl: 604800 }),
    ],
  },
});
```

### Example 5: ledger-ctrl egress (CDC)

```typescript
import { changeDataCapture } from '@nestfolio/event-processor';

export const handler = changeDataCapture({
  serviceName: 'ledger-ctrl',
  eventTypeMap: {
    'BalanceEvent:INSERT':      'BALANCE_UPDATED',
    'PortfolioEvent:INSERT':    'PORTFOLIO_UPDATED',
    'LedgerEntryEvent:INSERT':  'LEDGER_ENTRY_RECORDED',
  },
  groupBy: {
    key: (r) => `${r.pk}#${r.__typename}`,
    pick: 'last',
  },
});
```

### Example 6: ledger-ctrl reducer (replay and reduce)

```typescript
import { replayAndReduce } from '@nestfolio/event-processor';
import { accountReducer, emptyAccountState } from '@nestfolio/command-core';

export const handler = replayAndReduce({
  serviceName: 'ledger-ctrl',
  filter: (r) => r.__typename === 'LedgerEntry',
  groupBy: {
    key: (r) => `${r.tenantId}#${r.streamType}`,
  },
  reducer: accountReducer,
  initialState: emptyAccountState,
  snapshot: {
    key: (groupKey) => ({ pk: groupKey, sk: 'Snapshot#current' }),
    daily: true,
  },
});
```

### Example 7: materializeToBucket (S3 export)

```typescript
import { materializeToBucket, s3Put } from '@nestfolio/event-processor';

export const handler = materializeToBucket({
  serviceName: 'reporting-ctrl',
  handlers: {
    PORTFOLIO_SNAPSHOT_REQUESTED: async ({ subject }, ctx) => [
      s3Put({ positions: subject.positions, asOf: subject.timestamp }, { format: 'json' }),
    ],
    RECONCILIATION_EXPORT_REQUESTED: async ({ subject }) => [
      s3Put(subject.entries, { format: 'csv', key: `exports/${subject.tenantId}/reconciliation.csv` }),
    ],
  },
});
```

### Example 8: Low-level utilities (standalone)

```typescript
import { asyncPool, groupBy, forkMerge } from '@nestfolio/event-processor';

const results = await asyncPool(items, processItem, { concurrency: 5 });

const deduped = groupBy(records, { key: (r) => `${r.tenantId}#${r.id}`, pick: 'last' });

const branchResults = await forkMerge(records, [
  { filter: (r) => r.type === 'INSERT', process: handleInsert, concurrency: 5 },
  { filter: (r) => r.type === 'MODIFY', process: handleModify, concurrency: 3 },
]);
```

### Example 9: Testing

```typescript
import { createTestHarness, fakeSqsRecord } from '@nestfolio/event-processor/testing';
import { handlerConfig } from '../src/handlers/event-listener';

describe('ledger-ctrl', () => {
  const harness = createTestHarness(handlerConfig);

  it('records ledger entry on ORDER_FILLED', async () => {
    const result = await harness.process([
      fakeSqsRecord('ORDER_FILLED', { filledQty: 10, price: 150, currency: 'USD' }),
    ]);
    expect(result.intents).toEqual([
      expect.objectContaining({ _tag: 'record', typename: 'LedgerEntry', fields: expect.objectContaining({ amount: 1500 }) }),
    ]);
    expect(result.metrics.EventProcessed).toBe(1);
  });

  it('collects errors without blocking batch', async () => {
    const result = await harness.process([
      fakeSqsRecord('ORDER_FILLED', validPayload),
      fakeSqsRecord('ORDER_FILLED', null),
      fakeSqsRecord('DEPOSIT_DETECTED', validPayload),
    ]);
    expect(result.metrics.EventProcessed).toBe(2);
    expect(result.metrics.EventFailed).toBe(1);
    expect(result.batchItemFailures).toHaveLength(1);
  });

  it('skips poison pills', async () => {
    const result = await harness.process([
      fakeSqsRecord('ORDER_FILLED', badPayload, { receiveCount: 6 }),
    ]);
    expect(result.metrics.PoisonPillDetected).toBe(1);
    expect(result.batchItemFailures).toHaveLength(0);
  });
});
```

---

## Metrics

All metrics are published as a single CloudWatch `putMetricData` call at the end of each batch.

| Metric | Dimension | Emitted When |
|--------|-----------|-------------|
| `EventProcessed` | ServiceName, EventType | Record processed successfully |
| `EventFailed` | ServiceName, EventType | Retryable error (will retry via SQS) |
| `EventDropped` | ServiceName, EventType | Non-retryable error (published to bus, removed from queue) |
| `EventDeduplicated` | ServiceName, EventType | putIfNotExists/guardedWrite returned false |
| `PoisonPillDetected` | ServiceName | Record exceeded maxReceiveCount |
| `BatchSize` | ServiceName | Number of records in batch |
| `BatchDuration` | ServiceName | Total batch processing time (ms) |

---

## Migration Path

Services adopt event-processor incrementally:

1. **New services** — use event-processor from day one
2. **Existing services** — replace `createHandler` + manual loop with the appropriate pipeline factory; delete Pipe classes
3. **Existing Egress constructs** — replace Lambda-based Egress with `changeDataCapture` handler

No changes to CDK constructs are required. The event-processor is a handler-level library — it produces standard Lambda handler functions that work with existing Ingress/State/Egress CDK constructs.

---

## Dependencies

| Dependency | Purpose | Size |
|------------|---------|------|
| `p-limit` | Concurrency semaphore | ~1 KB |
| `@aws-sdk/lib-dynamodb` | DDB writes (already in all services) | shared |
| `@aws-sdk/client-s3` | S3 writes (only materializeToBucket) | shared |
| `@aws-sdk/client-eventbridge` | Error event publishing + CDC | shared |
| `@nestfolio/lambda-utils` | Logger, metrics, traceEvent, isRetryable, NotRetryableError | workspace |

No Highland. No RxJS. ~50 lines of custom async utilities (asyncPool, groupBy, forkMerge).

---

## Supersession Note

This design supersedes the approach outlined in `2026-03-15-transparent-idempotency-analysis.md`, which proposed `createEventProcessor` in `lambda-utils` with a `deps: EventListenerDeps` dependency injection pattern. Key differences:

- **Separate library** (`@nestfolio/event-processor`) instead of extending `lambda-utils`
- **Convention-based client creation** from env vars instead of explicit dependency injection
- **Intent helpers** instead of `WriteIntent[]` return with strategy enums
- **Store-then-CDC** principle instead of allowing direct EventBridge publish from SQS handlers
- **Named presets** instead of a single universal factory

The analysis doc remains valid as a reference for the current codebase state (35 write methods, 3 strategies, high-risk operations).
