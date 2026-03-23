# Ingestion/Egestion Engine Refactor — Design Spec

## Problem

The current `event-processor` engine layer uses names that describe AWS transport (`BatchEngine`/`StreamEngine`, `createEventHandler`/`createStreamHandler`) rather than architectural role. Both engines process arrays of events; the names don't reflect their real difference: **ingestion** (events entering the service's state store) vs **egestion** (state changes leaving the service).

This naming also makes it difficult to introduce alternative transports. The planned Kinesis Data Stream extension — where EventBridge routes events to Kinesis streams that trigger Lambda event-listeners in multiplex — requires the ingestion layer to be transport-agnostic.

## Goals

1. Rename engine layer to ingestion/egestion semantics
2. Extract transport-agnostic ingestion core from current `BatchEngine`
3. Implement SQS and Kinesis ingestion adapters
4. Keep egestion side unchanged (rename only)
5. Zero service-level code changes — all changes inside `libs/event-processor`

## Non-Goals

- CDK constructs for Kinesis event source mappings (separate effort when a service adopts Kinesis)
- FIFO/ordering guarantees (all processing remains order-agnostic)
- Changes to the egestion processing model

## Architecture

### Ingestion Flow (current: SQS)

```
EventBridge → SQS → Lambda → SqsAdapter → IngestionEngine → IntentExecutor → DynamoDB
```

### Ingestion Flow (future: Kinesis)

```
EventBridge → Kinesis → Lambda → KinesisAdapter → IngestionEngine → IntentExecutor → DynamoDB
```

### Egestion Flow (unchanged)

```
DynamoDB Stream → Lambda → EgestionEngine → EventBridge
```

### Layer Cake

Services interact at the pipeline level. Lower levels are public exports for extensibility but are not expected in standard service implementations.

```
Level 3 (pipeline):      materializeToTable({ handlers, transport? })
Level 2 (factory):       createIngestionHandler({ handlers, transport?, table, bus... })
Level 1 (engine+adapter): new IngestionEngine(config) + new SqsAdapter() — wire yourself
```

> **Pipeline-first principle:** All nestfolio services SHOULD use pipeline-level APIs (`materializeToTable`, `changeDataCapture`, `replayAndReduce`). Lower levels (`createIngestionHandler`, `IngestionEngine` + adapters) are public exports for extensibility but are not expected to be used in standard service implementations.

## Design Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Ingestion/egestion naming | Reflects architectural role (data flowing in vs out), not AWS transport. Stable across transport changes. |
| D2 | Kinesis filtering via handler map | The handler map already defines accepted event types. No separate filter config — single source of truth. |
| D3 | Kinesis partial batch response | Symmetric with SQS (`batchItemFailures` with sequence numbers). Only failed records retry. Requires `ReportBatchItemFailures` on event source mapping. |
| D4 | Order-agnostic processing | Concurrent `asyncPool` for both transports. All handlers are idempotent via `IdempotencyGuard`. No ordering guarantees needed or used. |
| D5 | No poison pill for Kinesis | Kinesis retry/DLQ handled at event source mapping level (`maxRetryAttempts` + `onFailure` destination). No in-engine detection. |
| D6 | Pipeline names unchanged | `materializeToTable`, `changeDataCapture`, `replayAndReduce` describe the pattern, not the transport. Gain optional `transport` field. |
| D7 | Record parser as strategy | Engine core calls `recordParser(raw)` — each adapter provides its own. Engine has zero transport-type imports. |
| D8 | Layer cake (Approach A) | Bottom-up split: extract transport-agnostic core, build adapters on top. Cleanest separation, engine core testable in isolation. |

## Detailed Design

### 1. Core Types (`ingestion-types.ts`)

```typescript
export interface IngestionRecord {
  id: string;              // messageId (SQS) or sequenceNumber (Kinesis)
  event: BusEvent;         // parsed, transport-agnostic
  metadata: {
    receiveCount?: number; // SQS only, undefined for Kinesis
  };
}

export interface IngestionResult {
  failures: string[];      // IDs of records that failed (retryable)
  metrics: Record<string, number>;
}

export interface IngestionAdapter<TEvent, TResponse> {
  toRecords(event: TEvent): IngestionRecord[];   // parse + filter + poison pill
  toResponse(result: IngestionResult): TResponse; // format transport-specific response
}
```

### 2. Ingestion Engine Core (`ingestion-engine.ts`)

Transport-agnostic. Receives `IngestionRecord[]`, returns `IngestionResult`.

Owns:
- Event-type routing (handler map lookup → skip unknown types)
- Handler execution → WriteIntents
- IntentExecutor (record, project, accumulate, update, skip, store)
- ErrorCollector (success, skipped, deduplicated, failed, dropped)
- **Error publishing** (non-retryable errors → EventBridge via `ErrorEventPublisher`). The engine publishes errors internally when `busName` is configured — this stays in the core, not in adapters, because error semantics are transport-independent.
- Metrics (EventProcessed, EventFailed, EventDeduplicated, EventDropped, EventSkipped, BatchSize, BatchDuration)
- asyncPool concurrency

**Note:** The engine core does NOT perform poison pill detection. That is an SQS-adapter-only concern. The core only performs event-type routing (skipping unknown types). However, `ErrorCollector` remains in the core — the SQS adapter calls `collector.recordPoisonPill()` before passing records to the engine, so poison pill metrics are tracked alongside other metrics in a single collector instance. The adapter owns the detection logic; the collector owns the bookkeeping.

```typescript
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
  constructor(config: IngestionEngineConfig);
  async process(records: IngestionRecord[]): Promise<IngestionResult>;
}
```

### 3. SQS Adapter (`sqs-adapter.ts`)

```typescript
export class SqsIngestionAdapter implements IngestionAdapter<SQSEvent, SQSBatchResponse> {
  constructor(options?: { poisonPillMaxReceiveCount?: number });

  toRecords(event: SQSEvent): IngestionRecord[];
  // - Parses SQSRecord.body → JSON → BusEvent
  // - Sets id = messageId, metadata.receiveCount = ApproximateReceiveCount
  // - Filters out poison pills (receiveCount > max), records them in collector

  toResponse(result: IngestionResult): SQSBatchResponse;
  // - Maps failures[] to { batchItemFailures: [{ itemIdentifier: id }] }
}
```

### 4. Kinesis Adapter (`kinesis-adapter.ts`)

```typescript
export class KinesisIngestionAdapter implements IngestionAdapter<KinesisStreamEvent, KinesisStreamBatchResponse> {
  toRecords(event: KinesisStreamEvent): IngestionRecord[];
  // - Decodes record.kinesis.data (base64) → JSON → BusEvent
  // - Sets id = record.kinesis.sequenceNumber, metadata.receiveCount = undefined
  // - No poison pill logic
  // - Filtering happens in engine core (unknown event types are skipped)

  toResponse(result: IngestionResult): KinesisStreamBatchResponse;
  // - Maps failures[] to { batchItemFailures: [{ itemIdentifier: id }] }
}
```

### 5. EventContext Changes

The current `EventContext` type is SQS-specific:
```typescript
// BEFORE
export interface EventContext {
  readonly receiveCount: number;   // required — breaks for Kinesis
  readonly record: SQSRecord;      // typed to SQS — leaks transport
}
```

Updated to be transport-agnostic:
```typescript
// AFTER
export interface EventContext {
  readonly receiveCount?: number;  // optional — undefined for Kinesis
  readonly record: unknown;        // raw transport record, opaque to handlers
}
```

- `receiveCount` becomes optional. SQS adapter sets it from `ApproximateReceiveCount`; Kinesis adapter leaves it `undefined`.
- `record` becomes `unknown`. Handlers that need the raw record (none currently do) must narrow the type themselves.
- All other fields (`eventId`, `eventType`, `tenantId`, `userId`, `timestamp`, `serviceName`) remain unchanged.

### 6. Record Parsers (`parse-sqs-record.ts`, `parse-kinesis-record.ts`)

Extracted as standalone functions used by their respective adapters:

```typescript
// parse-sqs-record.ts — replaces the existing parseRecord from internal.ts (no alias kept)
export function parseSqsRecord(record: SQSRecord): BusEvent;

// parse-kinesis-record.ts — new
export function parseKinesisRecord(record: KinesisStreamRecord): BusEvent;
```

### 7. Unified Factory (`create-ingestion-handler.ts`)

Uses function overloads for type-safe return types keyed on `transport`:

```typescript
export interface IngestionHandlerConfig {
  transport?: 'sqs' | 'kinesis';  // defaults to 'sqs'
  serviceName: string;
  handlers: Record<string, HandlerEntry>;
  table?: string | { name: string; client: DynamoDBDocumentClient };
  bus?: string;
  concurrency?: number;
  // SQS-specific (ignored for kinesis)
  poisonPill?: { maxReceiveCount: number };
  errorEventType?: string;
  s3?: { bucket: string };
}

// Overloads — callers get exact return type without assertions
export function createIngestionHandler(
  config: IngestionHandlerConfig & { transport?: 'sqs' },
): (event: SQSEvent, context?: Context) => Promise<SQSBatchResponse>;

export function createIngestionHandler(
  config: IngestionHandlerConfig & { transport: 'kinesis' },
): (event: KinesisStreamEvent, context?: Context) => Promise<KinesisStreamBatchResponse>;
```

Internally:
1. Creates SDK clients (DynamoDB, optionally S3)
2. Creates `IngestionEngine` with core config
3. Picks adapter: `transport === 'kinesis'` → `KinesisIngestionAdapter`, else `SqsIngestionAdapter`
4. Returns a Lambda handler that: calls `adapter.toRecords(event)` → `engine.process(records)` → `adapter.toResponse(result)`
5. Wraps with `applyMiddleware(withLambdaContext(), withTiming(...))`

### 8. Pipeline Changes

**`materializeToTable`** — gains optional `transport` field with overloads:
```typescript
export function materializeToTable(
  config: MaterializeToTableConfig & { transport?: 'sqs' },
): (event: SQSEvent, context?: Context) => Promise<SQSBatchResponse>;

export function materializeToTable(
  config: MaterializeToTableConfig & { transport: 'kinesis' },
): (event: KinesisStreamEvent, context?: Context) => Promise<KinesisStreamBatchResponse>;
```

**`changeDataCapture`** — import rename only (`StreamEngine` → `EgestionEngine`).

**`replayAndReduce`** — import rename only (`StreamEngine` → `EgestionEngine`).

### 9. Egestion Side (Rename Only)

| Current | Proposed |
|---------|----------|
| `stream-engine.ts` | `egestion-engine.ts` |
| `create-stream-handler.ts` | `create-egestion-handler.ts` |
| `StreamEngine` class | `EgestionEngine` class |
| `StreamEngineConfig` | `EgestionEngineConfig` |
| `createStreamHandler` | `createEgestionHandler` |

No behavioral changes. All internal logic, types (`StreamRecord`, `StreamContext`), and pipeline wiring stay the same.

## File Structure

```
libs/event-processor/src/engine/
  # Deleted:
  batch-engine.ts
  create-event-handler.ts

  # New:
  ingestion-engine.ts         — transport-agnostic core
  ingestion-types.ts          — IngestionRecord, IngestionResult, IngestionAdapter
  sqs-adapter.ts              — SqsIngestionAdapter
  kinesis-adapter.ts          — KinesisIngestionAdapter
  create-ingestion-handler.ts — unified factory
  parse-sqs-record.ts         — extracted SQS record parser
  parse-kinesis-record.ts     — new Kinesis record parser

  # Renamed:
  stream-engine.ts            → egestion-engine.ts
  create-stream-handler.ts    → create-egestion-handler.ts

  # Unchanged:
  normalize-handler.ts
  intent-executor.ts
  error-collector.ts
  error-event-publisher.ts
  base-collector.ts
  stream-collector.ts
```

## Public API Changes (`index.ts`)

**Removed exports:**
- `BatchEngine`, `BatchEngineConfig`
- `createEventHandler`, `EventHandlerConfig`
- `StreamEngine`, `StreamEngineConfig`
- `createStreamHandler`

**New exports:**
- `IngestionEngine`, `IngestionEngineConfig`
- `IngestionRecord`, `IngestionResult`, `IngestionAdapter`
- `SqsIngestionAdapter`, `KinesisIngestionAdapter`
- `createIngestionHandler`, `IngestionHandlerConfig`
- `parseSqsRecord`, `parseKinesisRecord`
- `EgestionEngine`, `EgestionEngineConfig`
- `createEgestionHandler`

**Unchanged exports:**
- `materializeToTable`, `changeDataCapture`, `replayAndReduce`
- `HandlerEntry`, `EventContext`, `BusEvent`, `WriteIntent`, etc.

## Testing Strategy

### New tests:
- `ingestion-engine.test.ts` — core routing, intent execution, error collection, metrics (fed `IngestionRecord[]` directly)
- `sqs-adapter.test.ts` — SQS record parsing, poison pill filtering, response formatting
- `kinesis-adapter.test.ts` — base64 decoding, handler-map filtering, response formatting
- `parse-kinesis-record.test.ts` — base64 → JSON → BusEvent, malformed input handling
- `create-ingestion-handler.test.ts` — factory wiring for both transports

### Migrated tests:
- `batch-engine.test.ts` → core logic to `ingestion-engine.test.ts`, SQS-specific to `sqs-adapter.test.ts`
- `create-event-handler.test.ts` → `create-ingestion-handler.test.ts` (SQS path)

### Renamed tests:
- `stream-engine.test.ts` → `egestion-engine.test.ts`
- `create-stream-handler.test.ts` → `create-egestion-handler.test.ts`

### Integration tests:
- `create-ingestion-handler.test.ts` includes round-trip tests: real SQS/Kinesis event fixtures → factory → adapter → engine → mock DDB client → verify intents executed and response formatted correctly. Tests both transport paths end-to-end.

### Service tests:
- No changes — services test against pipeline APIs which retain the same signatures.

## Migration

All changes are inside `libs/event-processor`. Zero service-level code changes.

1. Implement new engine core + types + adapters + parsers (all new files)
2. Implement unified factory (`createIngestionHandler`)
3. Rewire pipelines (`materializeToTable` → `createIngestionHandler`)
4. Rename egestion files (`StreamEngine` → `EgestionEngine`)
5. Update `index.ts` exports (remove old, add new)
6. Migrate tests
7. Run all projects — should pass with zero service changes
