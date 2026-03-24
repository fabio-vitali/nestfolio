# @nestfolio/event-processor

The single shared backend library for all Nestfolio services. It provides a declarative, intent-based framework for processing events from SQS, Kinesis, and DynamoDB Streams — writing results to DynamoDB, S3, or EventBridge with built-in error handling, metrics, and retry logic.

## Table of Contents

- [Architecture](#architecture)
- [Module Map](#module-map)
- [Ingestion (SQS / Kinesis → DynamoDB)](#ingestion-sqs--kinesis--dynamodb)
  - [materializeToTable](#materializetotable)
  - [materializeToBucket](#materializetobucket)
  - [resumeStateMachine](#resumestatemachine)
  - [createIngestionHandler (advanced)](#createingestionhandler-advanced)
- [Write Intents](#write-intents)
- [Egestion (DynamoDB Streams → EventBridge)](#egestion-dynamodb-streams--eventbridge)
  - [changeDataCapture](#changedatacapture)
  - [replayAndReduce](#replayandreduce)
  - [createEgestionHandler (advanced)](#createegestionhandler-advanced)
- [Platform Utilities](#platform-utilities)
- [Lambda Utilities](#lambda-utilities)
- [Domain Errors & Schemas](#domain-errors--schemas)
- [Event Sourcing](#event-sourcing)
- [Utility Functions](#utility-functions)
- [Testing](#testing)

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Event Sources                       │
│   SQS Queue    Kinesis Stream    DynamoDB Stream     │
└──────┬──────────────┬──────────────────┬────────────┘
       │              │                  │
       ▼              ▼                  ▼
┌──────────────────────────┐  ┌─────────────────────────┐
│   INGESTION ENGINE       │  │    EGESTION ENGINE       │
│                          │  │                          │
│  SqsIngestionAdapter     │  │  unmarshalStream()       │
│  KinesisIngestionAdapter │  │  filter / groupBy        │
│          │               │  │  processRecord/Group     │
│          ▼               │  │          │               │
│  normalizeHandler()      │  │          ▼               │
│  HandlerFn(payload, ctx) │  │  EventBridgePublisher    │
│          │               │  │  or custom processRecord │
│          ▼               │  │                          │
│  WriteIntent[]           │  └─────────────────────────┘
│  ┌────────────────┐      │
│  │ IntentExecutor  │      │
│  │ record → Put   │      │
│  │ project → Put  │      │
│  │ accumulate →   │      │
│  │   guardedWrite │      │
│  │ update →       │      │
│  │   UpdateCmd    │      │
│  │ store → S3 Put │      │
│  │ skip → no-op   │      │
│  └────────────────┘      │
│          │               │
│          ▼               │
│  ErrorCollector          │
│  → retryable: re-queue  │
│  → non-retryable: Bus   │
└──────────────────────────┘
```

**Core idea**: Handlers are pure functions `(payload, ctx) → WriteIntent[]`. The engine handles DynamoDB/S3 writes, error classification, metrics, and batch responses automatically.

---

## Module Map

```
libs/event-processor/src/
├── engine/          # IngestionEngine, EgestionEngine, adapters, IntentExecutor
├── pipelines/       # High-level factories: materializeToTable, changeDataCapture, etc.
├── intents/         # Intent builders: record(), project(), accumulate(), update(), store(), skip()
├── types/           # WriteIntent, EventContext, HandlerFn, StreamRecord, etc.
├── platform/        # Core: Event, Bus, errors, repos, FP (Result, pipe), branded types, market data
├── lambda/          # Auth, metrics, middleware (applyMiddleware, withTiming, withLambdaContext)
├── domain/          # DomainError hierarchy, BusEventSchema, TenantContextSchema
├── sourcing/        # Event sourcing: defineCommand, applyCommand, replayEvents
├── util/            # asyncPool, groupBy, forkMerge, toCsv, buildEventTypeMap
├── internal/        # Cross-cutting: middleware, tracer, logger, branded types
└── testing/         # Test harness, fake records (fakeSqsRecord, fakeDdbStreamRecord)
```

---

## Ingestion (SQS / Kinesis → DynamoDB)

### materializeToTable

The most common pattern. Processes SQS messages and writes results to a DynamoDB table.

```typescript
import {
  materializeToTable,
  record, project, skip,
  type EventPayload, type EventContext,
} from '@nestfolio/event-processor';

export const handler = materializeToTable({
  serviceName: 'my-service',
  handlers: {
    // Static intent — insert a row with deduplication
    'ORDER_CREATED': record('Order', (payload, ctx) => ({
      orderId: payload.subject.orderId,
      status: 'PENDING',
      createdAt: ctx.timestamp,
    })),

    // Upsert (no dedup condition)
    'PROFILE_UPDATED': project('Profile', (payload, ctx) => ({
      name: payload.subject.name,
      email: payload.subject.email,
      updatedAt: ctx.timestamp,
    })),

    // Custom async logic — call a service, then skip the DDB write
    'NOTIFICATION_TRIGGERED': async (payload: EventPayload, ctx: EventContext) => {
      await notificationService.send(ctx.tenantId, payload.subject);
      return skip();
    },
  },
  errorEventType: 'MY_SERVICE_FAILED', // published to EventBridge on non-retryable errors
});
```

**Config options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `serviceName` | `string` | required | Used in metrics, logs, and error events |
| `handlers` | `Record<string, HandlerEntry>` | required | Map of eventType → handler function or intent |
| `table` | `string` | `process.env.TABLE_NAME` | DynamoDB table name |
| `bus` | `string` | `process.env.BUS_NAME` | EventBridge bus for error events |
| `concurrency` | `number` | `3` | Max parallel record processing |
| `poisonPill` | `{ maxReceiveCount: number }` | `{ maxReceiveCount: 5 }` | Skip records received too many times |
| `errorEventType` | `string` | — | Custom event type for error events |
| `transport` | `'sqs' \| 'kinesis'` | `'sqs'` | Event source transport |

### materializeToBucket

Same as `materializeToTable` but writes to S3 instead of DynamoDB. Use `store()` intents.

```typescript
import { materializeToBucket, store, toCsv } from '@nestfolio/event-processor';

export const handler = materializeToBucket({
  serviceName: 'export-service',
  handlers: {
    'REPORT_GENERATED': (payload, ctx) =>
      store(payload.subject.rows, {
        format: 'csv',
        key: `reports/${ctx.tenantId}/${ctx.eventId}.csv`,
      }),
  },
  bucket: 'my-export-bucket',
});
```

### resumeStateMachine

Processes SQS events and resumes a Step Functions execution via `SendTaskSuccess`.

```typescript
import { resumeStateMachine, type ResumeHandler } from '@nestfolio/event-processor';

const handleOrderFilled: ResumeHandler = async (payload, ctx) => {
  const summary = await computeOrderSummary(payload.subject);
  return {
    output: { status: 'FILLED', summary },
    intents: [], // optional DDB writes
  };
};

export const handler = resumeStateMachine({
  serviceName: 'execution-ctrl',
  handlers: {
    'ORDER_FILLED': handleOrderFilled,
  },
  errorEventType: 'EXECUTION_CTRL_FAILED',
});
```

### createIngestionHandler (advanced)

Lower-level factory when you need full control over the DynamoDB client or transport.

```typescript
import { createIngestionHandler } from '@nestfolio/event-processor';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

export const handler = createIngestionHandler({
  transport: 'kinesis', // typed overload → returns KinesisStreamBatchResponse
  serviceName: 'stream-processor',
  handlers: myHandlerMap,
  table: { name: 'my-table', client: myDocClient },
  s3: { bucket: 'my-bucket' },
  concurrency: 5,
});
```

---

## Write Intents

Handlers return one or more `WriteIntent` values. The `IntentExecutor` translates them into DynamoDB/S3 operations.

| Intent | Builder | DynamoDB Operation | Description |
|--------|---------|-------------------|-------------|
| `record` | `record(typename, fields \| mapper, overrides?)` | `PutCommand` with `attribute_not_exists(pk)` | Insert-only with deduplication |
| `project` | `project(typename, fields \| mapper, overrides?)` | `PutCommand` (no condition) | Upsert / merge |
| `accumulate` | `accumulate(typename, { field, increment, ttl? })` | `guardedWrite` + `UpdateCommand` | Atomic counter with dedup guard |
| `update` | `update(typename, updates, { removes?, condition? })` | `UpdateCommand` | Conditional SET/REMOVE |
| `store` | `store(body, { format?, key? })` | `S3 PutObjectCommand` | Write to S3 (JSON or CSV) |
| `skip` | `skip()` | no-op | Explicitly skip writing |

**DynamoDB key strategy**: `PK = T#${tenantId}`, `SK = ${typename}#${eventId}` (default, overridable via `overrides`).

### Dual overloads (record, project)

Both `record()` and `project()` support two call signatures:

```typescript
// 1. Static: returns a WriteIntent directly (for use in handler maps)
record('Order', { orderId: '123', status: 'NEW' })

// 2. Mapper: returns a HandlerFn — receives payload & context at runtime
record('Order', (payload, ctx) => ({
  orderId: payload.subject.orderId,
  status: 'NEW',
  processedAt: ctx.timestamp,
}))
```

### accumulate example

```typescript
import { accumulate } from '@nestfolio/event-processor';

// Increment a counter atomically — deduplicates by eventId
accumulate('TradeCount', { field: 'count', increment: 1, ttl: 86400 })
```

### update example

```typescript
import { update } from '@nestfolio/event-processor';

// Conditionally update fields, remove others
update('Order', { status: 'FILLED', filledAt: new Date().toISOString() }, {
  removes: ['pendingReason'],
  condition: 'attribute_exists(pk) AND #s = :pending',
})
```

---

## Egestion (DynamoDB Streams → EventBridge)

### changeDataCapture

Publishes DynamoDB stream changes to EventBridge as domain events.

```typescript
import { changeDataCapture, buildEventTypeMap } from '@nestfolio/event-processor';

// Simple: auto-generates event types from entity names
// Notification:INSERT → NOTIFICATION_CREATED
// Notification:MODIFY → NOTIFICATION_UPDATED
// MonthlyReport:INSERT → MONTHLY_REPORT_CREATED
export const handler = changeDataCapture({
  serviceName: 'investor-ctrl',
  eventTypeMap: buildEventTypeMap(['Notification', 'MonthlyReport']),
});

// Custom: explicit mapping with optional transform
export const handler = changeDataCapture({
  serviceName: 'execution-ctrl',
  eventTypeMap: {
    'Order:INSERT': 'ORDER_PLACED',
    'Order:MODIFY': (record) => record.status === 'FILLED' ? 'ORDER_FILLED' : 'ORDER_UPDATED',
    'Trade:INSERT': 'TRADE_EXECUTED',
  },
  transform: (record, eventType) => ({
    orderId: record.orderId,
    status: record.status,
  }),
  groupBy: { key: (r) => r.tenantId, pick: 'last' },
});
```

### replayAndReduce

Event sourcing pattern: groups DynamoDB stream records, replays events through a reducer, and persists snapshots with optimistic concurrency.

```typescript
import { replayAndReduce } from '@nestfolio/event-processor';

interface PortfolioState {
  totalValue: number;
  holdings: Record<string, number>;
}

export const handler = replayAndReduce<PortfolioState>({
  serviceName: 'ledger-ctrl',
  filter: (r) => r.__typename === 'LedgerEntry',
  groupBy: { key: (r) => `${r.tenantId}#${r.portfolioId}` },
  reducer: (state, event) => {
    if (event.type === 'BUY') {
      return {
        ...state,
        totalValue: state.totalValue + (event.amount as number),
        holdings: { ...state.holdings, [event.symbol as string]: (state.holdings[event.symbol as string] ?? 0) + (event.qty as number) },
      };
    }
    return state;
  },
  initialState: { totalValue: 0, holdings: {} },
  snapshot: {
    key: (groupKey) => ({ pk: groupKey.split('#')[0], sk: `Snapshot#${groupKey}` }),
    daily: true,
  },
});
```

### createEgestionHandler (advanced)

Lower-level factory for custom DynamoDB stream processing.

```typescript
import { createEgestionHandler, type StreamRecord, type StreamContext } from '@nestfolio/event-processor';

export const handler = createEgestionHandler({
  serviceName: 'my-service',
  filter: (record) => record.__typename === 'Order',
  groupBy: { key: (r) => r.tenantId, pick: 'last' },
  processGroup: async (groupKey, records, ctx) => {
    // Custom processing logic
    await myService.processOrderBatch(groupKey, records);
  },
  concurrency: 5,
  bus: 'my-bus',
  errorEventType: 'MY_SERVICE_EGESTION_FAILED',
});
```

---

## Platform Utilities

Re-exported from `platform/` — the foundation layer.

### Core

```typescript
import { envVar, getTime, getUUID } from '@nestfolio/event-processor';

const region = envVar('AWS_REGION');     // throws if missing
const now = getTime();                    // ISO timestamp
const id = getUUID();                     // crypto.randomUUID()
```

### Bus (EventBridge)

```typescript
import { EventBridgeBus, type BusEvent } from '@nestfolio/event-processor';

const bus = new EventBridgeBus('my-bus', 'my-source');
await bus.publish({ type: 'ORDER_CREATED', subject: { orderId: '123' }, context: { tenantId: 't1' } });
```

### Errors

```typescript
import { NotRetryableError, isRetryable, handleClientError } from '@nestfolio/event-processor';

// Mark an error as non-retryable (won't re-queue in SQS)
throw new NotRetryableError('Invalid payload — missing required field');

// Check if an error should be retried
if (isRetryable(error)) { /* will be re-queued */ }
```

### FP / Result

```typescript
import { pipe, ok, err, isOk, mapResult, tryCatch } from '@nestfolio/event-processor';

const result = tryCatch(() => JSON.parse(raw));
if (isOk(result)) {
  const mapped = mapResult(result, (val) => val.data);
}
```

### Branded Types

```typescript
import { asTenantId, asUserId, asEventId, type TenantId } from '@nestfolio/event-processor';

const tenantId: TenantId = asTenantId('t_abc123'); // compile-time type safety
```

### Repositories

```typescript
import { TableRepository, EventRepository, BucketRepository } from '@nestfolio/event-processor';
```

---

## Lambda Utilities

Re-exported from `lambda/` — AWS Lambda-specific helpers.

### Middleware

```typescript
import { applyMiddleware, withLambdaContext, withTiming } from '@nestfolio/event-processor';

// Wrap any Lambda handler with cross-cutting concerns
export const handler = applyMiddleware(
  coreHandler,
  withLambdaContext(),                    // enrich logger with request context
  withTiming('my-service-resolver'),      // log duration + catch errors
);
```

Declaration order = execution order (outermost → innermost). This is **behavior wrapping**, not data transformation.

### Auth

```typescript
import { authorizeTenant, authorizeUser } from '@nestfolio/event-processor';

// Extract tenantId from Cognito claims (AppSync resolver)
const tenantId = authorizeTenant(event);

// Extract both tenantId + userId
const identity = authorizeUser(event); // { tenantId, userId }
```

### Metrics

```typescript
import { createServiceMetrics, MetricUnit } from '@nestfolio/event-processor';

const metrics = createServiceMetrics('my-service');
metrics.addMetric('EventProcessed', MetricUnit.Count, 1);
```

### Other

```typescript
import {
  requireEnv,           // throws if env var missing
  validateQueryDepth,   // AppSync query depth limit
  traceEvent,           // X-Ray annotations (EventType, EventId, TenantId)
  extractTenantId,      // pull tenantId from various event shapes
  guardedWrite,         // DDB conditional write with dedup
  publishErrorEvent,    // publish error event to EventBridge
} from '@nestfolio/event-processor';
```

---

## Domain Errors & Schemas

```typescript
import {
  DomainError,                  // base class for all domain errors
  DomainValidationError,        // invalid input
  EntityNotFoundError,          // 404
  BusinessRuleViolationError,   // invariant violated
  TenantAccessDeniedError,      // wrong tenant
  BusEventSchema,               // Zod schema for bus events
  TenantContextSchema,          // Zod schema for { tenantId }
} from '@nestfolio/event-processor';

throw new EntityNotFoundError('Order', orderId);
throw new BusinessRuleViolationError('Cannot cancel a filled order');
```

---

## Event Sourcing

```typescript
import { defineCommand, applyCommand, replayEvents, type LedgerEntry } from '@nestfolio/event-processor';
import { z } from 'zod';

// Define a command with Zod validation
const PlaceOrder = defineCommand({
  type: 'PLACE_ORDER',
  schema: z.object({ symbol: z.string(), qty: z.number().positive() }),
  apply: (state, payload) => ({
    ...state,
    orders: [...state.orders, { symbol: payload.symbol, qty: payload.qty, status: 'PENDING' }],
  }),
});

// Apply a command (validates, then applies)
const result = applyCommand(PlaceOrder, { symbol: 'AAPL', qty: 10 }, currentState);

// Replay events into state
const finalState = replayEvents(initialState, ledgerEntries, (state, event) => {
  switch (event.type) {
    case 'BUY': return { ...state, balance: state.balance - (event.amount as number) };
    case 'SELL': return { ...state, balance: state.balance + (event.amount as number) };
    default: return state;
  }
});
```

---

## Utility Functions

```typescript
import { asyncPool, groupBy, forkMerge, toCsv, toUow, buildEventTypeMap } from '@nestfolio/event-processor';

// Controlled concurrency
await asyncPool(items, processItem, { concurrency: 5 });

// Group items by key
const groups = groupBy(items, { key: (item) => item.category });

// Fork-merge: run parallel branches, merge results
const result = await forkMerge(input, [
  { match: (x) => x.type === 'A', process: handleA },
  { match: (x) => x.type === 'B', process: handleB },
]);

// Serialize to CSV
const csv = toCsv(rows, ['col1', 'col2', 'col3']);

// Convert event payload to UnitOfWork
const uow = toUow(payload);

// Auto-generate CDC event type map from entity names
const map = buildEventTypeMap(['Order', 'Trade']);
// → { 'Order:INSERT': 'ORDER_CREATED', 'Order:MODIFY': 'ORDER_UPDATED', 'Trade:INSERT': 'TRADE_CREATED', ... }
```

---

## Testing

The library provides test harnesses that mirror the engine behavior without hitting AWS services.

### Ingestion Test Harness

```typescript
import { createTestHarness, fakeSqsRecord, record } from '@nestfolio/event-processor';

describe('investor-ctrl event-listener', () => {
  const harness = createTestHarness({
    serviceName: 'investor-ctrl',
    handlers: {
      'DEPOSIT_INITIATED': record('Deposit', (payload, ctx) => ({
        amount: payload.subject.amount,
        depositedAt: ctx.timestamp,
      })),
    },
  });

  it('should produce a record intent for DEPOSIT_INITIATED', async () => {
    const records = [
      fakeSqsRecord('DEPOSIT_INITIATED', { amount: 1000 }),
    ];

    const result = await harness.process(records);

    expect(result.intents).toHaveLength(1);
    expect(result.intents[0]).toMatchObject({
      _tag: 'record',
      typename: 'Deposit',
      fields: { amount: 1000 },
    });
    expect(result.metrics.EventProcessed).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it('should skip unknown event types', async () => {
    const records = [fakeSqsRecord('UNKNOWN_EVENT', {})];
    const result = await harness.process(records);
    expect(result.skipped).toBe(1);
  });

  it('should detect poison pills', async () => {
    const records = [fakeSqsRecord('DEPOSIT_INITIATED', { amount: 1 }, { receiveCount: 10 })];
    const harness = createTestHarness({
      serviceName: 'test',
      handlers: { 'DEPOSIT_INITIATED': record('X', {}) },
      poisonPill: { maxReceiveCount: 5 },
    });
    const result = await harness.process(records);
    expect(result.poisonPills).toBe(1);
  });
});
```

### Stream Test Harness

```typescript
import { createStreamTestHarness, fakeDdbStreamRecord } from '@nestfolio/event-processor';

const harness = createStreamTestHarness({
  serviceName: 'my-service',
  processRecord: async (record, ctx) => {
    // your processing logic
  },
  filter: (record) => record.__typename === 'Order',
});

const result = await harness.process([
  fakeDdbStreamRecord('INSERT', { orderId: '1', status: 'NEW' }, { typename: 'Order' }),
  fakeDdbStreamRecord('INSERT', { logId: '2' }, { typename: 'AuditLog' }), // filtered out
]);

expect(result.processed).toBe(1);
expect(result.filtered).toBe(1);
```

### CDC Test Harness

```typescript
import { createCdcTestHarness, fakeDdbStreamRecord } from '@nestfolio/event-processor';

const harness = createCdcTestHarness({
  serviceName: 'my-service',
  eventTypeMap: {
    'Order:INSERT': 'ORDER_CREATED',
    'Order:MODIFY': 'ORDER_UPDATED',
  },
});

const result = await harness.process([
  fakeDdbStreamRecord('INSERT', { orderId: '1' }, { typename: 'Order' }),
]);

expect(result.publishedEvents).toHaveLength(1);
expect(result.publishedEvents[0].eventType).toBe('ORDER_CREATED');
```

### Reducer Test Harness

```typescript
import { createReducerTestHarness, fakeDdbStreamRecord } from '@nestfolio/event-processor';

const harness = createReducerTestHarness<{ total: number }>({
  serviceName: 'ledger-ctrl',
  groupBy: { key: (r) => `${r.tenantId}#${r.portfolioId}` },
  reducer: (state, event) => ({ total: state.total + (event.amount as number) }),
  initialState: { total: 0 },
  snapshot: { key: (gk) => ({ pk: gk.split('#')[0], sk: `Snapshot#${gk}` }) },
});

// Seed existing state
harness.seedSnapshot('t1#p1', { total: 500 }, 1, 5);
harness.seedEvents('t1#p1', [
  { type: 'BUY', amount: 100, sequenceNo: 6 },
  { type: 'BUY', amount: 200, sequenceNo: 7 },
]);

const result = await harness.process([
  fakeDdbStreamRecord('INSERT', { portfolioId: 'p1' }, { typename: 'LedgerEntry', tenantId: 't1' }),
]);

expect(result.snapshots.get('t1#p1')?.state.total).toBe(800);
expect(result.snapshots.get('t1#p1')?.version).toBe(2);
```

### Fake Record Factories

```typescript
import { fakeSqsRecord, fakeDdbStreamRecord } from '@nestfolio/event-processor';

// SQS record with custom tenant and receive count
fakeSqsRecord('ORDER_CREATED', { orderId: '123' }, {
  eventId: 'evt-1',
  tenantId: 'tenant-abc',
  receiveCount: 3,
});

// DynamoDB stream record (INSERT, MODIFY, or REMOVE)
fakeDdbStreamRecord('MODIFY', { orderId: '123', status: 'FILLED' }, {
  typename: 'Order',
  tenantId: 'tenant-abc',
  oldImage: { orderId: '123', status: 'PENDING' },
});
```

---

## Running Tests

```bash
pnpm nx test event-processor
```
