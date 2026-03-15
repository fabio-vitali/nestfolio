# @nestfolio/event-processor — DDB Stream Pipelines Design

Companion spec to `2026-03-15-event-processor-design.md`. Covers the DDB Stream half of the event-processor framework: `createStreamHandler`, `changeDataCapture`, `replayAndReduce`, and the deferred SQS preset `materializeToBucket`.

## Design Decisions

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| 1 | replayAndReduce data fetch | Query-since-checkpoint | Stream batch is a trigger; query all entries since last snapshot sequence. Resilient to out-of-order delivery and shard splits. Matches battle-tested ledger-ctrl pattern. |
| 2 | CDC EventBridge publish | Inline in CDC pipeline | Self-contained ~25-line publisher with batch-of-10 + 2 retries. No cross-library dependency. Old event-publisher becomes dead code after migration. |
| 3 | Stream error handling | Process all, then decide | Consistent with SQS philosophy: isolate at the processing unit, process everything, classify after. Binary throw/no-throw adapted to DDB Stream's all-or-nothing retry. |
| 4 | replayAndReduce query | Hybrid (convention + override) | Convention-based default (pk from record, sk prefix from typename, sequenceNo filter). Override via `queryEvents` for non-standard schemas. Consistent with "convention over configuration" principle. |
| 5 | materializeToBucket | SQS preset only | No DDB Stream variant needed. YAGNI. |
| 6 | Stream handler return type | Void + own I/O | Stream handlers do their own writes (CDC publishes to EventBridge, reducer writes snapshots). No WriteIntent system — stream patterns don't map cleanly to existing intents. |

---

## New Files

| File | Purpose |
|------|---------|
| `engine/stream-engine.ts` | Core DDB Stream batch loop (parallels BatchEngine) |
| `engine/base-collector.ts` | Shared outcome collection (success, error, metrics) used by both engines |
| `engine/error-event-publisher.ts` | Shared fire-and-forget error event publishing with try/catch guard |
| `pipelines/create-stream-handler.ts` | Universal stream factory |
| `pipelines/change-data-capture.ts` | CDC preset (Stream -> EventBridge) |
| `pipelines/replay-and-reduce.ts` | Event sourcing preset (Stream -> query -> reduce -> snapshot) |
| `pipelines/materialize-to-bucket.ts` | SQS preset (deferred — uses existing BatchEngine) |
| `util/event-bridge-publisher.ts` | Batch publish with retry (internal, used by CDC) |
| `util/unmarshal-stream.ts` | DDB record -> StreamRecord + StreamContext |

## Modified Files

| File | Change |
|------|--------|
| `index.ts` | Export new pipelines, types, testing helpers |
| `engine/error-collector.ts` | Refactor: extend `BaseCollector` with SQS-specific fields (batchItemFailures, dedup, poison) |
| `engine/batch-engine.ts` | Refactor: use `ErrorEventPublisher` (fire-and-forget with guard), add `causedBy` to error events |
| `testing/test-harness.ts` | Add `createStreamTestHarness()`, `createCdcTestHarness()`, `createReducerTestHarness()` |
| `testing/fake-records.ts` | Enhance `fakeDdbStreamRecord()` with typename/tenantId/sequenceNo convenience opts |

---

## Engine Consistency (SQS ↔ DDB Stream)

Both engines follow the same processing philosophy. Shared code is extracted to avoid drift.

### Shared Infrastructure

**`BaseCollector`** — abstract outcome tracking used by both engines:

```typescript
abstract class BaseCollector {
  protected readonly metrics: Record<string, number> = {};
  protected readonly errors: Array<{ id: string; error: Error; retryable: boolean; causedBy: unknown }> = [];

  recordSuccess(id: string): void;
  recordError(id: string, error: Error, retryable: boolean, causedBy: unknown): void;
  getErrors(): { retryable: typeof this.errors; nonRetryable: typeof this.errors };
  getMetrics(): Record<string, number>;
}
```

- `ErrorCollector` (SQS) extends with: `batchItemFailures`, `recordDeduplicated()`, `recordPoisonPill()`, `recordSkipped()`, SQS-specific metric names (`EventProcessed`, `EventFailed`, etc.)
- `StreamCollector` (DDB) extends with: `hasRetryableErrors()` (determines throw/no-throw), Stream-specific metric names (`StreamRecordProcessed`, `StreamRecordFailed`, etc.)

**`ErrorEventPublisher`** — shared fire-and-forget error event publishing:

```typescript
class ErrorEventPublisher {
  constructor(private busName: string, private serviceName: string) {}

  async publishErrors(
    errors: Array<{ error: Error; causedBy: unknown; groupKey?: string }>,
    errorEventType: string,
  ): Promise<void> {
    for (const { error, causedBy, groupKey } of errors) {
      try {
        // Build EventBridge entry with causedBy field
        await this.publish({
          type: errorEventType,
          subject: { error: error.message, stack: error.stack, causedBy, groupKey },
          context: { serviceName: this.serviceName },
        });
      } catch (pubErr) {
        // Fire-and-forget: log but never throw
        logger.warn('Failed to publish error event', { pubErr, originalError: error.message });
      }
    }
  }
}
```

Both engines use `ErrorEventPublisher`. The try/catch guard is **per-error** — a failure to publish one error event does not prevent publishing the others, and never affects the batch outcome.

### Side-by-Side Flow

| Step | SQS BatchEngine | DDB StreamEngine |
|------|----------------|-----------------|
| 1. Parse | `parseRecord(sqsRecord)` | `unmarshalStream(ddbRecord)` |
| 2. Pre-filter | Poison pill check | `filter` callback |
| 3. Context | Build `EventContext` + `traceEvent` | `StreamContext` (from unmarshal) |
| 4. Route/Group | Handler lookup by `eventType` | Optional `groupBy` + pick |
| 5. Process | `handler()` → `WriteIntent[]` → `intentExecutor` | `processRecord/Group()` → void (own I/O) |
| 6. Collect | `ErrorCollector` (extends `BaseCollector`) | `StreamCollector` (extends `BaseCollector`) |
| 7. Error events | `ErrorEventPublisher` (fire-and-forget, with `causedBy`) | `ErrorEventPublisher` (same, with `causedBy`) |
| 8. Metrics | Single `putMetricData` call | Single `putMetricData` call |
| 9. Return | `{ batchItemFailures }` | void or throw `StreamBatchError` |

### SQS Backfill (during implementation)

The existing `BatchEngine` requires two fixes for consistency:

1. **`causedBy` in error events** — include the parsed event payload in error events (currently only publishes the error message)
2. **Error publish guard** — replace the unguarded `for` loop (lines 112-117) with `ErrorEventPublisher` (fire-and-forget with try/catch per error)

---

## Circular Error Event Prevention

Error events (`_FAILED`, `_STREAM_FAILED`) are published to the same EventBridge bus as business events. This is safe because:

1. **Ingress routes by explicit `detailType` list** — `eventPattern: { detailType: props.eventTypes }`. Error event types are only routed if a service explicitly lists them. No wildcard matching.

2. **Error event publishing is fire-and-forget** — `ErrorEventPublisher` wraps each publish in try/catch. A publish failure is logged but never thrown. This prevents retry loops where: batch fails → error publish fails → batch retries → same failure.

3. **Convention: `_FAILED` and `_STREAM_FAILED` suffixes are reserved.** These MUST NOT appear in any Ingress `eventTypes` array. This is a CDK-level convention documented here and enforced by code review.

The error events are consumed by monitoring/alerting infrastructure (CloudWatch rules, SNS topics), not by service Ingress constructs.

---

## StreamEngine

The `StreamEngine` mirrors `BatchEngine` — it is the internal orchestrator that all stream pipelines delegate to.

### Config

```typescript
interface StreamEngineConfig {
  serviceName: string;
  filter?: (record: StreamRecord) => boolean;
  groupBy?: {
    key: (record: StreamRecord) => string;
    pick?: 'first' | 'last' | 'all';  // default: 'all'
  };
  // Exactly one of these:
  processRecord?: (record: StreamRecord, ctx: StreamContext) => Promise<void>;
  processGroup?: (groupKey: string, records: StreamRecord[], ctx: StreamContext) => Promise<void>;
  concurrency?: number;        // default: 3
  busName?: string;            // for error events
  errorEventType?: string;
}
```

### Processing Flow

```
StreamEngine (per Lambda invocation)

  1. UNMARSHAL
     For each DynamoDBRecord → unmarshalStream() → { StreamRecord, StreamContext }
     Records with no image (malformed) → skip with warning

  2. FILTER
     If filter provided, skip non-matching records

  3. GROUP (if groupBy)
     groupBy.key → Map<string, StreamRecord[]>
     Apply pick strategy ('first' | 'last' | 'all')

  4. PROCESS (asyncPool, concurrency-limited)
     Per record (no groupBy):  processRecord(record, ctx)
     Per group (with groupBy): processGroup(groupKey, records, ctx)
     Each unit wrapped in try/catch → collects outcome

  5. POST-BATCH CLASSIFY
     Non-retryable errors → publish error event to bus (with causedBy), log
     Any retryable errors  → throw StreamBatchError (DDB Stream retries entire batch)
     All success            → return void (checkpoint advances)

  6. METRICS
     Single putMetricData call (see Metrics section)
```

### Key Differences from BatchEngine

- **No `batchItemFailures` return** — binary throw/no-throw is the only retry control
- **Handlers return `void`** — they do their own I/O (publish to EventBridge, write snapshots) rather than returning WriteIntents
- **Default concurrency: 3** (not 5) — stream batches tend to be smaller and more latency-sensitive
- **No poison pill detection** — DDB Streams don't have a receive count equivalent; the stream shard iterator handles retries

### `unmarshalStream` Utility

```typescript
function unmarshalStream(record: DynamoDBRecord, serviceName: string): {
  streamRecord: StreamRecord;
  ctx: StreamContext;
} | null {
  const eventName = record.eventName as 'INSERT' | 'MODIFY' | 'REMOVE';
  const image = eventName === 'REMOVE'
    ? record.dynamodb?.OldImage
    : record.dynamodb?.NewImage;

  // Guard: skip records with no image (e.g., REMOVE on NEW_IMAGE-only streams)
  if (!image) return null;

  const unmarshalled = unmarshall(image as Record<string, AttributeValue>);

  return {
    streamRecord: {
      pk: unmarshalled.pk as string,
      sk: unmarshalled.sk as string,
      __typename: unmarshalled.__typename as string,
      tenantId: unmarshalled.tenantId as string,
      ...unmarshalled,
    },
    ctx: {
      serviceName,
      record,
      eventName,
      keys: { pk: unmarshalled.pk as string, sk: unmarshalled.sk as string },
      typename: unmarshalled.__typename as string,
      tenantId: unmarshalled.tenantId as string,
      newImage: eventName !== 'REMOVE' ? unmarshalled : undefined,
      oldImage: record.dynamodb?.OldImage
        ? unmarshall(record.dynamodb.OldImage as Record<string, AttributeValue>)
        : undefined,
    },
  };
}
```

**Requirement:** DDB tables used with stream pipelines MUST use `NEW_AND_OLD_IMAGES` StreamViewType. Records with no image are skipped with a warning log (the function returns `null`).

---

## `createStreamHandler` (universal)

```typescript
interface StreamHandlerConfig {
  serviceName: string;
  processRecord?: (record: StreamRecord, ctx: StreamContext) => Promise<void>;
  processGroup?: (groupKey: string, records: StreamRecord[], ctx: StreamContext) => Promise<void>;
  groupBy?: {
    key: (record: StreamRecord) => string;
    pick?: 'first' | 'last' | 'all';
  };
  filter?: (record: StreamRecord) => boolean;
  concurrency?: number;          // default: 3
  bus?: string | { name: string; client: EventBridgeClient };
  table?: string | { name: string; client: DynamoDBDocumentClient };
  errorEventType?: string;
}

function createStreamHandler(config: StreamHandlerConfig): (event: DynamoDBStreamEvent) => Promise<void>;
```

Thin wrapper that creates a `StreamEngine` from config. When `bus`/`table` is a string, auto-creates clients from environment. When an object, uses provided client (testing, custom config).

---

## `changeDataCapture` (preset)

### Config

```typescript
interface ChangeDataCaptureConfig {
  serviceName: string;
  eventTypeMap: Record<string, string | ((record: StreamRecord) => string)>;
  // key format: 'TypeName:INSERT' | 'TypeName:MODIFY' | 'TypeName:REMOVE'
  groupBy?: {
    key: (record: StreamRecord) => string;
    pick?: 'first' | 'last';    // default: 'last'
  };
  bus?: string;                  // default: process.env.BUS_NAME
  concurrency?: number;          // default: 3
  transform?: (record: StreamRecord, eventType: string) => Record<string, unknown>;
}

function changeDataCapture(config: ChangeDataCaptureConfig): (event: DynamoDBStreamEvent) => Promise<void>;
```

### Internal Flow

1. Builds a `StreamEngine` with:
   - **filter**: only records whose `${typename}:${eventName}` key exists in `eventTypeMap`
   - **groupBy**: passthrough from config
   - **processRecord** (no groupBy) or **processGroup** (with groupBy)

2. **Event type resolution**: look up `eventTypeMap[${typename}:${eventName}]`. String → use directly. Function → call with record.

3. **Event envelope** (matches existing Egress convention):

```typescript
{
  id: ctx.record.eventID ?? uuid(),    // from raw DynamoDBRecord (note: eventID, not eventId)
  type: resolvedEventType,
  timestamp: new Date().toISOString(),  // stream records don't carry a business timestamp
  subject: transform ? transform(record, eventType) : record,
  context: { tenantId: record.tenantId },
}
```

4. **Publish via `EventBridgePublisher`** (internal utility).

5. **With `groupBy` + `pick: 'last'`**: deduplicates within the batch. Multiple MODIFY events for the same entity → only the last one is published.

### EventBridgePublisher (internal)

```typescript
class EventBridgePublisher {
  constructor(
    private client: EventBridgeClient,
    private busName: string,
    private source: string,
  ) {}

  async publish(entries: PutEventsRequestEntry[]): Promise<void>;
}
```

Implementation:
- Batch in chunks of 10 (EventBridge limit)
- Per-chunk: inspect `PutEvents` response for `FailedEntryCount > 0`
  - Extract failed entries from the response by matching `ErrorCode`
  - Retryable error codes: `ThrottlingException`, `InternalException` → retry only the failed entries (up to 2 retries)
  - Non-retryable error codes (e.g., `ValidationException`) → throw `NotRetryableError` immediately
- Retryable failures after exhausting 2 retries → throw `Error` (retryable, StreamEngine will retry batch)

~25 lines. Same logic as existing `event-publisher.ts` but encapsulated. Instantiated once per `changeDataCapture()` call (cold start), reused across invocations.

### Consumer Example

```typescript
// compliance-ctrl egress
export const handler = changeDataCapture({
  serviceName: 'compliance-ctrl',
  eventTypeMap: {
    'ComplianceResult:INSERT': (r) =>
      r.passed ? 'DECISION_PACKET_ENRICHED' : 'DECISION_BLOCKED',
  },
  groupBy: {
    key: (r) => `${r.tenantId}#${r.decisionId}`,
    pick: 'last',
  },
});

// ledger-ctrl egress
export const handler = changeDataCapture({
  serviceName: 'ledger-ctrl',
  eventTypeMap: {
    'BalanceEvent:INSERT':     'BALANCE_UPDATED',
    'PortfolioEvent:INSERT':   'PORTFOLIO_UPDATED',
    'LedgerEntryEvent:INSERT': 'LEDGER_ENTRY_RECORDED',
  },
  groupBy: {
    key: (r) => `${r.pk}#${r.__typename}`,
    pick: 'last',
  },
});
```

---

## `replayAndReduce` (preset)

### Config

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
    daily?: boolean;              // default: false
  };
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

### Convention-Based Query (default)

When `queryEvents` is omitted, the pipeline derives the query from the stream records in the group:

1. **pk**: from the first record in the group — `record.pk`
2. **sk prefix**: from the filtered records' `__typename` — `begins_with(sk, '${typename}#')`
3. **sequenceNo filter**: `sequenceNo > lastSnapshotSequence`
4. **ScanIndexForward**: `true` (ascending for deterministic reduction)

```typescript
async function conventionQuery(
  groupKey: string,
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
  return result.Items ?? [];
}
```

Convention documented: "pk from the stream record, sk prefix from `__typename`, sorted by `sequenceNo`." The convention query uses the `__typename` of the **first record in the group**. All records in a group should share the same typename. If a group contains mixed typenames (e.g., groupBy key is `tenantId` across multiple entity types), the convention query will miss records — use `queryEvents` override instead. Services with non-standard schemas (GSI queries, mixed types) override via `queryEvents`.

### Per-Group Processing Flow

1. **Load current snapshot** from DDB at `snapshot.key(groupKey)`
   - Not found → use `initialState` (or call `initialState()` if function), with implicit `version = 0` and `lastEventSequence = 0`
   - Found → extract `lastEventSequence` and `version` from snapshot

2. **Query events since checkpoint** — convention query or `queryEvents` override

3. **Sort by `sequenceNo`** (ascending) — defensive, even though convention query uses `ScanIndexForward`

4. **Reduce**: `events.reduce((state, event) => reducer(state, event), currentState)`

5. **Save snapshot** with conditional write:
   ```
   ConditionExpression: 'attribute_not_exists(pk) OR version = :expectedVersion'
   ```
   Snapshot record: `{ ...reducedState, version: nextVersion, lastEventSequence: maxSeq, updatedAt: now() }`

6. **Conditional write fails** (ConditionalCheckFailedException) → classified as **retryable** error. StreamEngine throws after processing all groups. On retry, snapshot is re-read with correct version.

7. **Daily checkpoint** (if `daily: true`): save to `{ pk: snapshotKey.pk, sk: 'Snapshot#${YYYY-MM-DD}' }` with `attribute_not_exists(pk)` condition (item doesn't exist yet — skip if checkpoint already exists for today).

### Consumer Examples

```typescript
// ledger-ctrl — convention query (no queryEvents needed)
export const handler = replayAndReduce({
  serviceName: 'ledger-ctrl',
  filter: (r) => r.__typename === 'LedgerEntry',
  groupBy: {
    key: (r) => `${r.tenantId}#${r.streamType}`,
  },
  reducer: accountReducer,
  initialState: INITIAL_ACCOUNT_STATE,
  snapshot: {
    key: (groupKey) => {
      const [tenantId] = groupKey.split('#');
      return { pk: `T#${tenantId}`, sk: 'Snapshot#current' };
    },
    daily: true,
  },
});

// Non-standard service — queryEvents override (GSI query)
export const handler = replayAndReduce({
  serviceName: 'portfolio-ctrl',
  filter: (r) => r.__typename === 'PortfolioEvent',
  groupBy: { key: (r) => r.portfolioId as string },
  queryEvents: async (groupKey, lastSequence, clients) => {
    const result = await clients.docClient.send(new QueryCommand({
      TableName: clients.tableName,
      IndexName: 'portfolio-index',
      KeyConditionExpression: 'portfolioId = :pid',
      FilterExpression: 'sequenceNo > :seq',
      ExpressionAttributeValues: { ':pid': groupKey, ':seq': lastSequence },
      ScanIndexForward: true,
    }));
    return result.Items ?? [];
  },
  reducer: portfolioReducer,
  initialState: emptyPortfolioState,
  snapshot: { key: (gk) => ({ pk: `P#${gk}`, sk: 'Snapshot#current' }) },
});
```

---

## `materializeToBucket` (SQS preset)

Deferred from the SQS implementation phase. Thin wrapper over `createEventHandler`.

### Config

```typescript
interface MaterializeToBucketConfig {
  serviceName: string;
  handlers: Record<string, HandlerEntry>;
  bucket?: string;          // default: process.env.EXPORT_BUCKET
  bus?: string;             // default: process.env.BUS_NAME
  concurrency?: number;
  poisonPill?: { maxReceiveCount: number };
  defaultFormat?: 'json' | 'csv';   // default: 'json'
}

function materializeToBucket(config: MaterializeToBucketConfig):
  (event: SQSEvent, context?: Context) => Promise<SQSBatchResponse>;
```

Implementation: delegates to `createEventHandler` with `s3: { bucket: config.bucket ?? process.env.EXPORT_BUCKET }`. The `IntentExecutor` already handles `s3-put` intents. The `defaultFormat` applies at the `materializeToBucket` level: the `s3Put()` helper's `format` parameter becomes optional (defaults to `'json'`), and `materializeToBucket` overrides that default with `config.defaultFormat` if provided. This requires making `S3PutIntent.format` optional in the type definition (currently required). ~20 lines.

---

## Metrics

Single `putMetricData` call post-batch.

| Metric | Dimension | Emitted When |
|--------|-----------|-------------|
| `StreamRecordProcessed` | ServiceName | Record/group processed successfully |
| `StreamRecordFailed` | ServiceName | Error during processing |
| `StreamBatchSize` | ServiceName | Total records in DDB Stream batch |
| `StreamBatchDuration` | ServiceName | Total batch processing time (ms) |
| `SnapshotUpdated` | ServiceName | replayAndReduce saved a snapshot |
| `SnapshotConflict` | ServiceName | Optimistic concurrency conflict (will retry) |
| `EventsPublished` | ServiceName | CDC published events to EventBridge |

`Stream*` prefix distinguishes from SQS `Event*` metrics so both can coexist on the same CloudWatch dashboard.

---

## Error Events

All error events include `causedBy` — the StreamRecord that caused the failure.

```typescript
{
  type: errorEventType ?? `${SCREAMING_SNAKE(serviceName)}_STREAM_FAILED`,
  subject: {
    error: message,
    stack: stack,
    causedBy: streamRecord,    // the StreamRecord that caused the failure
    groupKey?: string,         // if grouped processing
  },
  context: { serviceName },
}
```

The `_STREAM_FAILED` suffix distinguishes stream errors from SQS listener errors (`_FAILED`) for the same service.

**SQS consistency note:** The existing SQS `BatchEngine` error events should also include `causedBy` with the parsed event payload. This is a small backfill fix to apply during implementation.

---

## Testing

### `createStreamTestHarness`

For `createStreamHandler` — general-purpose stream handler testing.

```typescript
interface StreamTestResult {
  processed: number;
  filtered: number;
  errors: Array<{ groupKey?: string; error: Error; retryable: boolean }>;
  thrown: boolean;            // whether the engine would have thrown
  metrics: Record<string, number>;
}

function createStreamTestHarness(config: StreamHandlerConfig): {
  process: (records: DynamoDBRecord[]) => Promise<StreamTestResult>;
};
```

### `createCdcTestHarness`

For `changeDataCapture` — intercepts EventBridge publishes.

```typescript
interface CdcTestResult extends StreamTestResult {
  publishedEvents: Array<{
    eventType: string;
    subject: Record<string, unknown>;
    context: Record<string, unknown>;
  }>;
}

function createCdcTestHarness(config: ChangeDataCaptureConfig): {
  process: (records: DynamoDBRecord[]) => Promise<CdcTestResult>;
};
```

### `createReducerTestHarness`

For `replayAndReduce` — intercepts snapshot reads/writes with seeding support.

```typescript
interface ReducerTestResult<S> extends StreamTestResult {
  snapshots: Map<string, { state: S; version: number; lastEventSequence: number }>;
  dailyCheckpoints: Map<string, S>;
  queriedGroups: string[];
}

function createReducerTestHarness<S>(config: ReplayAndReduceConfig<S>): {
  seedSnapshot: (groupKey: string, state: S, version: number, lastSeq: number) => void;
  seedEvents: (groupKey: string, events: Record<string, unknown>[]) => void;  // scoped to group
  process: (records: DynamoDBRecord[]) => Promise<ReducerTestResult<S>>;
};
```

### Enhanced `fakeDdbStreamRecord`

```typescript
function fakeDdbStreamRecord(
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE',
  newImage: Record<string, unknown>,
  opts?: {
    oldImage?: Record<string, unknown>;
    typename?: string;       // auto-set __typename if not in newImage
    tenantId?: string;       // auto-set tenantId if not in newImage
    sequenceNo?: number;     // auto-set sequenceNo if not in newImage
  },
): DynamoDBRecord;
```

### Test Examples

```typescript
// CDC test
describe('compliance-ctrl egress', () => {
  const harness = createCdcTestHarness({
    serviceName: 'compliance-ctrl',
    eventTypeMap: {
      'ComplianceResult:INSERT': (r) =>
        r.passed ? 'DECISION_PACKET_ENRICHED' : 'DECISION_BLOCKED',
    },
    groupBy: { key: (r) => `${r.tenantId}#${r.decisionId}`, pick: 'last' },
  });

  it('publishes enriched event when compliance passes', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { passed: true, decisionId: 'd1', verdict: 'approved' },
        { typename: 'ComplianceResult', tenantId: 't1' }),
    ]);
    expect(result.publishedEvents).toEqual([
      expect.objectContaining({ eventType: 'DECISION_PACKET_ENRICHED' }),
    ]);
  });

  it('deduplicates with pick:last in same batch', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { passed: false, decisionId: 'd1', version: 1 },
        { typename: 'ComplianceResult', tenantId: 't1' }),
      fakeDdbStreamRecord('INSERT', { passed: true, decisionId: 'd1', version: 2 },
        { typename: 'ComplianceResult', tenantId: 't1' }),
    ]);
    expect(result.publishedEvents).toHaveLength(1);
    expect(result.publishedEvents[0].eventType).toBe('DECISION_PACKET_ENRICHED');
  });
});

// replayAndReduce test
describe('ledger-ctrl reducer', () => {
  const harness = createReducerTestHarness({
    serviceName: 'ledger-ctrl',
    filter: (r) => r.__typename === 'LedgerEntry',
    groupBy: { key: (r) => `${r.tenantId}#${r.streamType}` },
    reducer: accountReducer,
    initialState: INITIAL_ACCOUNT_STATE,
    snapshot: {
      key: (gk) => {
        const [t] = gk.split('#');
        return { pk: `T#${t}`, sk: 'Snapshot#current' };
      },
      daily: true,
    },
  });

  it('reduces from initial state when no snapshot exists', async () => {
    harness.seedEvents('t1#actual', [
      { eventType: 'ORDER_FILLED', payload: { amount: 1500 }, sequenceNo: 1 },
    ]);
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { streamType: 'actual' },
        { typename: 'LedgerEntry', tenantId: 't1', sequenceNo: 1 }),
    ]);
    expect(result.snapshots.get('t1#actual')?.state).toEqual(
      expect.objectContaining({ cashBalanceCents: -1500 }),
    );
  });

  it('applies delta on top of existing snapshot', async () => {
    harness.seedSnapshot('t1#actual', { cashBalanceCents: 5000, positions: {} }, 3, 10);
    harness.seedEvents('t1#actual', [
      { eventType: 'DEPOSIT_DETECTED', payload: { amount: 2000 }, sequenceNo: 11 },
    ]);
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { streamType: 'actual' },
        { typename: 'LedgerEntry', tenantId: 't1', sequenceNo: 11 }),
    ]);
    expect(result.snapshots.get('t1#actual')?.version).toBe(4);
  });
});
```
