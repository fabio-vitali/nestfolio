# Event-Processor Migration Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all hand-rolled event-listener and event-publisher code across 11 services with `@nestfolio/event-processor` pipelines.

**Architecture:** Each event-listener migrates from manual `parseRecord`/switch/metrics boilerplate to `createEventHandler()` with a declarative handlers map. Each DDB Stream event-publisher migrates from the shared `lambda-utils/event-publisher.ts` handler to per-service `changeDataCapture()` handlers. Business logic stays unchanged — handlers delegate to existing services/repos and return `skip()`.

**Tech Stack:** `@nestfolio/event-processor` (createEventHandler, changeDataCapture, buildEventTypeMap, skip, createTestHarness, createCdcTestHarness, fakeSqsRecord, fakeDdbStreamRecord)

**Key constraint (compliance-ctrl):** Event-listener must ONLY persist state (via repository). Domain events are published exclusively by the CDC event-publisher reading the DDB stream. No `bus.publish()` calls in the listener.

**Key constraint (event-processor):** `@nestfolio/event-processor` is a standalone, publishable library — NO `@nestfolio/*` workspace imports allowed. Task 0 internalizes all current workspace dependencies before the migration begins.

---

## Dependency Graph

```
Task 0 ─────────────────────┐
                             ├──→ Tasks 1,2 (infrastructure)
                             │         ├──→ Tasks 3,4,5,6 (CDC handlers)
Tasks 7,8,9,10,11,12,13 ────┘─────────┘──→ (independent, can start after Task 0)
                             │
All of 3-13 ─────────────────┼──→ Task 14 (cleanup)
Task 14 ─────────────────────┼──→ Task 15 (verify)
```

## Migration Patterns Reference

### Event-Listener: Before → After

**Before** (~90 lines per service):
```typescript
import { parseRecord, isRetryable, createServiceMetrics, MetricUnit, traceEvent,
  applyMiddleware, withLambdaContext, withTiming, publishErrorEvent, EventBridgeBus, type Bus } from '@nestfolio/lambda-utils';

export interface EventListenerDeps {
  readonly repository: SomeRepo;
  readonly bus: Bus;                    // ← removed after migration
  readonly metrics: ReturnType<typeof createServiceMetrics>; // ← removed
}

export const createHandler = (deps: EventListenerDeps) =>
  async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const failures: string[] = [];
    for (const record of event.Records) {
      try {
        const uow = parseRecord(record);
        traceEvent(uow.event.type, uow.event.id);
        // ... switch/case routing ...
        deps.metrics.addMetric('EventProcessed', MetricUnit.Count, 1);
      } catch (error) {
        await publishErrorEvent(deps.bus, 'SERVICE_FAILED', error);
        deps.metrics.addMetric('EventFailed', MetricUnit.Count, 1);
        if (isRetryable(error)) failures.push(record.messageId);
      }
    }
    deps.metrics.publishStoredMetrics();
    return { batchItemFailures: failures.map(id => ({ itemIdentifier: id })) };
  };

const deps = { repository, bus: new EventBridgeBus(...), metrics: createServiceMetrics(...) };
export const handler = applyMiddleware(createHandler(deps), withLambdaContext(), withTiming(...));
```

**After** (~30 lines per service):
```typescript
import { createEventHandler, skip, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { requireEnv } from '@nestfolio/lambda-utils';

export interface EventListenerDeps {
  readonly repository: SomeRepo;  // only business deps remain
}

function toEvent(payload: EventPayload, ctx: EventContext): Record<string, unknown> {
  return { id: ctx.eventId, type: ctx.eventType, timestamp: ctx.timestamp,
    subject: payload.subject, context: payload.context ?? { tenantId: ctx.tenantId } };
}

export const createHandlers = (deps: EventListenerDeps) => ({
  'EVENT_A': async (payload: EventPayload, ctx: EventContext) => {
    await deps.repository.doSomething(toEvent(payload, ctx));
    return skip();
  },
});

const deps: EventListenerDeps = { repository: new SomeRepo(requireEnv('TABLE_NAME')) };
export const handler = createEventHandler({
  serviceName: 'my-service',
  handlers: createHandlers(deps),
  table: requireEnv('TABLE_NAME'),
  bus: requireEnv('BUS_NAME'),
  errorEventType: 'MY_SERVICE_FAILED',
});
```

### Event-Listener Test: Before → After

**Before:**
```typescript
function buildSqsEvent(records: Array<{ messageId: string; body: Record<string, unknown> }>): SQSEvent { ... }
const handler = createHandler(mockDeps);
const result = await handler(buildSqsEvent([{ messageId: 'm1', body: { detail: { type: 'FOO', ... } } }]));
expect(result.batchItemFailures).toHaveLength(0);
```

**After:**
```typescript
import { createTestHarness, fakeSqsRecord } from '@nestfolio/event-processor';
const harness = createTestHarness({ serviceName: 'test', handlers: createHandlers(mockDeps) });
const result = await harness.process([fakeSqsRecord('FOO', { field: 'value' }, { tenantId: 't1' })]);
expect(result.skipped).toBe(1);
expect(mockDeps.repository.doSomething).toHaveBeenCalled();
```

### CDC Event-Publisher Pattern

```typescript
// services/x/y/src/handlers/event-publisher.ts
import { changeDataCapture, buildEventTypeMap } from '@nestfolio/event-processor';

export const handler = changeDataCapture({
  serviceName: 'my-service',
  eventTypeMap: buildEventTypeMap(
    ['TypeA', 'TypeB'],
    { 'TypeA:INSERT': 'CUSTOM_EVENT_NAME' },  // optional overrides
  ),
});
```

---

## Chunk 0: Internalize event-processor dependencies

### Task 0: Remove all `@nestfolio/*` workspace imports from event-processor

`@nestfolio/event-processor` must be a standalone, publishable library. Currently it imports 11 utilities from `@nestfolio/lambda-utils` and `@nestfolio/platform-core`. This task copies all needed utilities into `libs/event-processor/src/internal/` and rewires all imports.

**Utilities to internalize (~413 LOC total):**

| Utility | Source | NPM Deps | Notes |
|---------|--------|----------|-------|
| `parseRecord` | lambda-utils/sqs-parser.ts | aws-lambda | Returns parsed SQS record with BusEvent envelope |
| `isRetryable` | platform-core/errors.ts | none | Checks error.retryable flag |
| `NotRetryableError` | platform-core/errors.ts | none | Error subclass with retryable=false |
| `traceEvent` | lambda-utils/trace-event.ts | none | X-Ray annotation helper (uses tracer) |
| `extractTenantId` | lambda-utils/extract-tenant-id.ts | none | Extracts tenantId from event context/subject |
| `applyMiddleware` | lambda-utils/middleware/apply-middleware.ts | aws-lambda | Composes middleware chain |
| `withLambdaContext` | lambda-utils/middleware/with-lambda-context.ts | aws-lambda | Sets Lambda context + cold start detection |
| `withTiming` | lambda-utils/middleware/with-timing.ts | none | Logs execution duration |
| `guardedWrite` | lambda-utils/guarded-write.ts | @aws-sdk/lib-dynamodb | Idempotent DDB write with ProcessedEvent dedup |
| `logger` | platform-core/logger.ts | @aws-lambda-powertools/logger | Logger singleton |
| `tracer` | platform-core/tracer.ts | @aws-lambda-powertools/tracer | Tracer singleton |
| `getUUID` | platform-core/core.ts | node:crypto | `() => randomUUID()` |
| `getTime` | platform-core/core.ts | Date built-in | `() => new Date().toISOString()` |

**Files to update (10 source + 2 test):**
- `src/engine/batch-engine.ts` — uses parseRecord, isRetryable, traceEvent, extractTenantId
- `src/engine/stream-engine.ts` — uses isRetryable, logger
- `src/engine/intent-executor.ts` — uses guardedWrite
- `src/engine/error-event-publisher.ts` — uses logger, getUUID, getTime
- `src/pipelines/create-event-handler.ts` — uses applyMiddleware, withLambdaContext, withTiming
- `src/pipelines/change-data-capture.ts` — uses getUUID
- `src/pipelines/replay-and-reduce.ts` — uses logger
- `src/testing/test-harness.ts` — uses isRetryable
- `src/util/event-bridge-publisher.ts` — uses NotRetryableError
- `test/engine/error-collector.test.ts` — uses NotRetryableError
- `test/util/event-bridge-publisher.test.ts` — uses NotRetryableError

**Files:**
- Create: `libs/event-processor/src/internal/logger.ts`
- Create: `libs/event-processor/src/internal/tracer.ts`
- Create: `libs/event-processor/src/internal/errors.ts`
- Create: `libs/event-processor/src/internal/core.ts`
- Create: `libs/event-processor/src/internal/sqs-parser.ts`
- Create: `libs/event-processor/src/internal/trace-event.ts`
- Create: `libs/event-processor/src/internal/extract-tenant-id.ts`
- Create: `libs/event-processor/src/internal/guarded-write.ts`
- Create: `libs/event-processor/src/internal/middleware.ts` (applyMiddleware + withLambdaContext + withTiming combined)
- Create: `libs/event-processor/src/internal/index.ts` (barrel export)
- Modify: 10 source files + 2 test files (update imports)

- [ ] **Step 1: Create `internal/errors.ts`**

Copy `NotRetryableError` and `isRetryable` from `libs/platform-core/src/errors.ts`. These are pure functions with no deps.

```typescript
// libs/event-processor/src/internal/errors.ts
export class NotRetryableError extends Error {
  readonly retryable = false;
  constructor(message: string) {
    super(message);
    this.name = 'NotRetryableError';
  }
}

export function isRetryable(error: unknown): boolean {
  if (error instanceof Error && 'retryable' in error) {
    return (error as { retryable: boolean }).retryable !== false;
  }
  return true;
}
```

- [ ] **Step 2: Create `internal/core.ts`**

```typescript
// libs/event-processor/src/internal/core.ts
import { randomUUID } from 'node:crypto';

export function getUUID(): string { return randomUUID(); }
export function getTime(): string { return new Date().toISOString(); }
```

- [ ] **Step 3: Create `internal/logger.ts` and `internal/tracer.ts`**

Copy from platform-core. These are singleton initializations:

```typescript
// libs/event-processor/src/internal/logger.ts
import { Logger } from '@aws-lambda-powertools/logger';
export const logger = new Logger({ serviceName: process.env.SERVICE_NAME ?? 'event-processor' });
```

```typescript
// libs/event-processor/src/internal/tracer.ts
import { Tracer } from '@aws-lambda-powertools/tracer';
export const tracer = new Tracer({ serviceName: process.env.SERVICE_NAME ?? 'event-processor' });
```

Note: Check the actual platform-core source for exact constructor args and copy faithfully. The logger may have additional config (logLevel, etc.).

- [ ] **Step 4: Create `internal/sqs-parser.ts`**

Copy `parseRecord` from `libs/lambda-utils/src/sqs-parser.ts`. Update its internal imports to use `./errors` and define the `BusEvent`/`UnitOfWork` types inline (or in a local types file) since they come from platform-core.

Note: The `BusEvent` and `UnitOfWork` types used by `parseRecord` are simple interfaces. Copy the type definitions into the internal module rather than importing them.

- [ ] **Step 5: Create `internal/trace-event.ts`**

Copy from `libs/lambda-utils/src/trace-event.ts`. Update `tracer` import to `./tracer`.

- [ ] **Step 6: Create `internal/extract-tenant-id.ts`**

Copy from `libs/lambda-utils/src/extract-tenant-id.ts`. Update `NotRetryableError` import to `./errors`.

- [ ] **Step 7: Create `internal/guarded-write.ts`**

Copy from `libs/lambda-utils/src/guarded-write.ts`. No `@nestfolio/*` deps — only uses `@aws-sdk/lib-dynamodb`.

- [ ] **Step 8: Create `internal/middleware.ts`**

Combine all three middleware utilities into one file:

```typescript
// libs/event-processor/src/internal/middleware.ts
import type { Context } from 'aws-lambda';
import { logger } from './logger';

// Copy applyMiddleware from lambda-utils/src/middleware/apply-middleware.ts
// Copy withLambdaContext from lambda-utils/src/middleware/with-lambda-context.ts
// Copy withTiming from lambda-utils/src/middleware/with-timing.ts
// Update logger import to ./logger
```

- [ ] **Step 9: Create `internal/index.ts` barrel**

```typescript
// libs/event-processor/src/internal/index.ts
export { NotRetryableError, isRetryable } from './errors';
export { getUUID, getTime } from './core';
export { logger } from './logger';
export { tracer } from './tracer';
export { parseRecord } from './sqs-parser';
export { traceEvent } from './trace-event';
export { extractTenantId } from './extract-tenant-id';
export { guardedWrite } from './guarded-write';
export { applyMiddleware, withLambdaContext, withTiming } from './middleware';
```

- [ ] **Step 10: Update all imports in event-processor source files**

Replace all `@nestfolio/lambda-utils` and `@nestfolio/platform-core` imports with `../internal` (or appropriate relative path):

```
src/engine/batch-engine.ts:
  - from '@nestfolio/lambda-utils' → from '../internal'

src/engine/stream-engine.ts:
  - from '@nestfolio/lambda-utils' → from '../internal'
  - from '@nestfolio/platform-core' → from '../internal'

src/engine/intent-executor.ts:
  - from '@nestfolio/lambda-utils' → from '../internal'

src/engine/error-event-publisher.ts:
  - from '@nestfolio/platform-core' → from '../internal'

src/pipelines/create-event-handler.ts:
  - from '@nestfolio/lambda-utils' → from '../internal'

src/pipelines/change-data-capture.ts:
  - from '@nestfolio/platform-core' → from '../internal'

src/pipelines/replay-and-reduce.ts:
  - from '@nestfolio/platform-core' → from '../internal'

src/testing/test-harness.ts:
  - from '@nestfolio/lambda-utils' → from '../internal'

src/util/event-bridge-publisher.ts:
  - from '@nestfolio/lambda-utils' → from '../internal'
```

- [ ] **Step 11: Update test imports**

```
test/engine/error-collector.test.ts:
  - from '@nestfolio/lambda-utils' → from '../../src/internal'

test/util/event-bridge-publisher.test.ts:
  - from '@nestfolio/lambda-utils' → from '../../src/internal'
```

- [ ] **Step 12: Verify zero @nestfolio/* imports remain**

```bash
grep -r "from '@nestfolio/" libs/event-processor/src/ libs/event-processor/test/
```
Expected: No matches

- [ ] **Step 13: Run all event-processor tests**

Run: `npx nx test event-processor`
Expected: ALL tests pass

- [ ] **Step 14: Add @aws-lambda-powertools deps to event-processor package.json**

Check if `@aws-lambda-powertools/logger` and `@aws-lambda-powertools/tracer` need to be listed in `libs/event-processor/package.json` dependencies (they may already be available from the workspace root). If event-processor is publishable, they must be in its `package.json`:

```json
{
  "dependencies": {
    "@aws-lambda-powertools/logger": "^2.x",
    "@aws-lambda-powertools/tracer": "^2.x",
    "@aws-sdk/client-dynamodb": "^3.x",
    "@aws-sdk/lib-dynamodb": "^3.x",
    "@aws-sdk/client-eventbridge": "^3.x",
    "@aws-sdk/util-dynamodb": "^3.x"
  },
  "peerDependencies": {
    "aws-lambda": "^1.x"
  }
}
```

Note: Match the exact versions used in the root `package.json`.

- [ ] **Step 15: Commit**

```bash
git add libs/event-processor/
git commit -m "refactor(event-processor): internalize all @nestfolio/* dependencies for standalone publishability"
```

---

## Chunk 1: Infrastructure

### Task 1: Add `buildEventTypeMap` utility to event-processor

**Files:**
- Create: `libs/event-processor/src/util/build-event-type-map.ts`
- Modify: `libs/event-processor/src/index.ts` (add export)
- Create: `libs/event-processor/test/util/build-event-type-map.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// libs/event-processor/test/util/build-event-type-map.test.ts
import { buildEventTypeMap } from '../../src/util/build-event-type-map';

describe('buildEventTypeMap', () => {
  it('generates INSERT + MODIFY mappings from publishable types', () => {
    const result = buildEventTypeMap(['Goal', 'RiskProfile']);
    expect(result).toEqual({
      'Goal:INSERT': 'GOAL_CREATED',
      'Goal:MODIFY': 'GOAL_UPDATED',
      'RiskProfile:INSERT': 'RISK_PROFILE_CREATED',
      'RiskProfile:MODIFY': 'RISK_PROFILE_UPDATED',
    });
  });

  it('converts PascalCase to SCREAMING_SNAKE', () => {
    const result = buildEventTypeMap(['DecisionPacket', 'VirtualCashBalance']);
    expect(result['DecisionPacket:INSERT']).toBe('DECISION_PACKET_CREATED');
    expect(result['VirtualCashBalance:MODIFY']).toBe('VIRTUAL_CASH_BALANCE_UPDATED');
  });

  it('applies custom overrides', () => {
    const result = buildEventTypeMap(
      ['Deposit', 'Withdrawal'],
      { 'Deposit:INSERT': 'DEPOSIT_INITIATED', 'Withdrawal:INSERT': 'WITHDRAWAL_REQUESTED' },
    );
    expect(result).toEqual({
      'Deposit:INSERT': 'DEPOSIT_INITIATED',
      'Deposit:MODIFY': 'DEPOSIT_UPDATED',
      'Withdrawal:INSERT': 'WITHDRAWAL_REQUESTED',
      'Withdrawal:MODIFY': 'WITHDRAWAL_UPDATED',
    });
  });

  it('returns empty map for empty input', () => {
    expect(buildEventTypeMap([])).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test event-processor -- --testPathPattern='build-event-type-map'`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// libs/event-processor/src/util/build-event-type-map.ts

function toScreamingSnake(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
}

/**
 * Builds a `changeDataCapture` eventTypeMap from a list of DynamoDB __typename values.
 * Generates INSERT → _CREATED and MODIFY → _UPDATED mappings using SCREAMING_SNAKE convention.
 * Custom overrides replace convention-based mappings for specific keys.
 */
export function buildEventTypeMap(
  publishableTypes: string[],
  customMap?: Record<string, string>,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const type of publishableTypes) {
    const screaming = toScreamingSnake(type);
    map[`${type}:INSERT`] = `${screaming}_CREATED`;
    map[`${type}:MODIFY`] = `${screaming}_UPDATED`;
  }
  return { ...map, ...customMap };
}
```

- [ ] **Step 4: Add export to index.ts**

Add to `libs/event-processor/src/index.ts`:
```typescript
export { buildEventTypeMap } from './util/build-event-type-map';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx nx test event-processor -- --testPathPattern='build-event-type-map'`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add libs/event-processor/src/util/build-event-type-map.ts libs/event-processor/src/index.ts libs/event-processor/test/util/build-event-type-map.test.ts
git commit -m "feat(event-processor): add buildEventTypeMap utility for CDC handler configs"
```

---

### Task 2: Update Egress construct to accept custom handler entry

**Files:**
- Modify: `libs/cdk-constructs/src/egress.ts`
- Modify: `libs/cdk-constructs/test/egress.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `libs/cdk-constructs/test/egress.test.ts`:
```typescript
it('uses custom handlerEntry when provided', () => {
  const { template } = createEgress({
    handlerEntry: '/tmp/custom-handler.ts',
  });
  // Should still create a Lambda function (the entry path changes but template structure is the same)
  template.hasResourceProperties('AWS::Lambda::Function', {
    Environment: {
      Variables: Match.objectLike({
        BUS_NAME: Match.anyValue(),
        SERVICE_NAME: 'test-svc',
      }),
    },
  });
});

it('omits CUSTOM_EVENT_TYPE_MAP when handlerEntry is provided', () => {
  const { template } = createEgress({
    handlerEntry: '/tmp/custom-handler.ts',
    customEventTypeMap: { 'Order:INSERT': 'ORDER_CREATED' },
  });
  template.hasResourceProperties('AWS::Lambda::Function', {
    Environment: {
      Variables: Match.objectLike({
        BUS_NAME: Match.anyValue(),
        SERVICE_NAME: 'test-svc',
        CUSTOM_EVENT_TYPE_MAP: Match.absent(),
      }),
    },
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test cdk-constructs -- --testPathPattern='egress'`
Expected: FAIL — handlerEntry not recognized / CUSTOM_EVENT_TYPE_MAP still present

- [ ] **Step 3: Update Egress construct**

In `libs/cdk-constructs/src/egress.ts`, update `EgressProps`:
```typescript
export interface EgressProps {
  /** DynamoDB __typename values to publish events for */
  publishableTypes: string[];
  /**
   * Optional map of "__typename:eventName" -> custom DetailType (legacy handler only).
   * Ignored when handlerEntry is provided — define the map in the handler code instead.
   */
  customEventTypeMap?: Record<string, string>;
  /** Path to a custom CDC handler file. When provided, uses this instead of the shared lambda-utils handler. */
  handlerEntry?: string;
}
```

Update the `NodejsFunction` in the constructor:
```typescript
const publisher = new NodejsFunction(this, 'Publisher', {
  ...defaultLambdaProps(this),
  entry: props.handlerEntry ?? EVENT_PUBLISHER_ENTRY,
  environment: {
    BUS_NAME: eventBus.eventBusName,
    SERVICE_NAME: serviceName,
    ...(!props.handlerEntry && props.customEventTypeMap && {
      CUSTOM_EVENT_TYPE_MAP: JSON.stringify(props.customEventTypeMap),
    }),
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test cdk-constructs -- --testPathPattern='egress'`
Expected: PASS (all egress tests)

- [ ] **Step 5: Commit**

```bash
git add libs/cdk-constructs/src/egress.ts libs/cdk-constructs/test/egress.test.ts
git commit -m "feat(cdk-constructs): add handlerEntry prop to Egress for per-service CDC handlers"
```

---

## Chunk 2: CDC Event-Publisher Migration

All 9 services with Egress constructs get per-service `changeDataCapture` handlers. Each handler file is ~10 lines. Each test file verifies the event type mapping.

### Task 3: Investor domain CDC handlers

**Files:**
- Create: `services/investor/investor-bff/src/handlers/event-publisher.ts`
- Create: `services/investor/investor-bff/test/handlers/event-publisher.test.ts`
- Modify: `services/investor/investor-bff/src/service.stack.ts`
- Create: `services/investor/investor-ctrl/src/handlers/event-publisher.ts`
- Create: `services/investor/investor-ctrl/test/event-publisher.test.ts`
- Modify: `services/investor/investor-ctrl/src/service.stack.ts`

- [ ] **Step 1: Write investor-bff CDC test**

```typescript
// services/investor/investor-bff/test/handlers/event-publisher.test.ts
import { createCdcTestHarness, fakeDdbStreamRecord, buildEventTypeMap } from '@nestfolio/event-processor';

const eventTypeMap = buildEventTypeMap(
  ['Goal', 'RiskProfile', 'Mandate', 'OperatingModeRecord', 'InvestorProfile', 'Deposit', 'Withdrawal'],
  { 'Deposit:INSERT': 'DEPOSIT_INITIATED', 'Withdrawal:INSERT': 'WITHDRAWAL_REQUESTED' },
);

describe('investor-bff event-publisher', () => {
  const harness = createCdcTestHarness({ serviceName: 'investor-bff', eventTypeMap });

  it('publishes GOAL_CREATED for Goal INSERT', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'Goal', tenantId: 't1', goalAmount: 100000 }),
    ]);
    expect(result.publishedEvents).toHaveLength(1);
    expect(result.publishedEvents[0].type).toBe('GOAL_CREATED');
  });

  it('publishes DEPOSIT_INITIATED for Deposit INSERT (custom override)', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'Deposit', tenantId: 't1', amount: 5000 }),
    ]);
    expect(result.publishedEvents).toHaveLength(1);
    expect(result.publishedEvents[0].type).toBe('DEPOSIT_INITIATED');
  });

  it('publishes RISK_PROFILE_UPDATED for RiskProfile MODIFY', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('MODIFY', { __typename: 'RiskProfile', tenantId: 't1', score: 7 }),
    ]);
    expect(result.publishedEvents).toHaveLength(1);
    expect(result.publishedEvents[0].type).toBe('RISK_PROFILE_UPDATED');
  });
});
```

- [ ] **Step 2: Write investor-ctrl CDC test**

```typescript
// services/investor/investor-ctrl/test/event-publisher.test.ts
import { createCdcTestHarness, fakeDdbStreamRecord, buildEventTypeMap } from '@nestfolio/event-processor';

const eventTypeMap = buildEventTypeMap(['Notification', 'MonthlyReport']);

describe('investor-ctrl event-publisher', () => {
  const harness = createCdcTestHarness({ serviceName: 'investor-ctrl', eventTypeMap });

  it('publishes NOTIFICATION_CREATED for Notification INSERT', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'Notification', tenantId: 't1', channel: 'email' }),
    ]);
    expect(result.publishedEvents).toHaveLength(1);
    expect(result.publishedEvents[0].type).toBe('NOTIFICATION_CREATED');
  });

  it('publishes MONTHLY_REPORT_CREATED for MonthlyReport INSERT', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'MonthlyReport', tenantId: 't1' }),
    ]);
    expect(result.publishedEvents[0].type).toBe('MONTHLY_REPORT_CREATED');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx nx test investor-bff -- --testPathPattern='event-publisher' && npx nx test investor-ctrl -- --testPathPattern='event-publisher'`
Expected: FAIL — handler files don't exist

- [ ] **Step 4: Create investor-bff CDC handler**

```typescript
// services/investor/investor-bff/src/handlers/event-publisher.ts
import { changeDataCapture, buildEventTypeMap } from '@nestfolio/event-processor';

export const handler = changeDataCapture({
  serviceName: 'investor-bff',
  eventTypeMap: buildEventTypeMap(
    ['Goal', 'RiskProfile', 'Mandate', 'OperatingModeRecord', 'InvestorProfile', 'Deposit', 'Withdrawal'],
    { 'Deposit:INSERT': 'DEPOSIT_INITIATED', 'Withdrawal:INSERT': 'WITHDRAWAL_REQUESTED' },
  ),
});
```

- [ ] **Step 5: Create investor-ctrl CDC handler**

```typescript
// services/investor/investor-ctrl/src/handlers/event-publisher.ts
import { changeDataCapture, buildEventTypeMap } from '@nestfolio/event-processor';

export const handler = changeDataCapture({
  serviceName: 'investor-ctrl',
  eventTypeMap: buildEventTypeMap(['Notification', 'MonthlyReport']),
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx nx test investor-bff -- --testPathPattern='event-publisher' && npx nx test investor-ctrl -- --testPathPattern='event-publisher'`
Expected: PASS

- [ ] **Step 7: Update service stacks**

In `services/investor/investor-bff/src/service.stack.ts`, update Egress:
```typescript
import { join } from 'path';
// ...
const egress = new Egress(this, 'Egress', {
  publishableTypes: ['Goal', 'RiskProfile', 'Mandate', 'OperatingModeRecord', 'InvestorProfile', 'Deposit', 'Withdrawal'],
  handlerEntry: join(__dirname, 'handlers/event-publisher.ts'),
});
```
Remove the `customEventTypeMap` from the Egress props (it's now in the handler code).

In `services/investor/investor-ctrl/src/service.stack.ts`, update Egress:
```typescript
import { join } from 'path';
// ...
const egress = new Egress(this, 'Egress', {
  publishableTypes: ['Notification', 'MonthlyReport'],
  handlerEntry: join(__dirname, 'handlers/event-publisher.ts'),
});
```

- [ ] **Step 8: Commit**

```bash
git add services/investor/investor-bff/src/handlers/event-publisher.ts services/investor/investor-bff/test/handlers/event-publisher.test.ts services/investor/investor-bff/src/service.stack.ts services/investor/investor-ctrl/src/handlers/event-publisher.ts services/investor/investor-ctrl/test/event-publisher.test.ts services/investor/investor-ctrl/src/service.stack.ts
git commit -m "feat(investor): migrate investor-bff + investor-ctrl to event-processor CDC handlers"
```

---

### Task 4: Advisory domain CDC handlers

**Files:**
- Create: `services/advisory/advisory-ctrl/src/handlers/event-publisher-cdc.ts` (note: `event-publisher.ts` already exists for AgentCore tools — use different name)
- Create: `services/advisory/advisory-ctrl/test/event-publisher-cdc.test.ts`
- Modify: `services/advisory/advisory-ctrl/src/service.stack.ts`
- Create: `services/advisory/advisory-bff/src/handlers/event-publisher.ts`
- Create: `services/advisory/advisory-bff/test/handlers/event-publisher.test.ts`
- Modify: `services/advisory/advisory-bff/src/service.stack.ts`
- Create: `services/advisory/compliance-ctrl/src/handlers/event-publisher.ts`
- Create: `services/advisory/compliance-ctrl/test/event-publisher.test.ts`
- Modify: `services/advisory/compliance-ctrl/src/service.stack.ts`

- [ ] **Step 1: Write CDC tests for all 3 advisory services**

**advisory-ctrl** (`test/event-publisher-cdc.test.ts`):
```typescript
import { createCdcTestHarness, fakeDdbStreamRecord, buildEventTypeMap } from '@nestfolio/event-processor';

const eventTypeMap = buildEventTypeMap(['DecisionPacket', 'AgentInvocation', 'WorkflowState']);

describe('advisory-ctrl CDC event-publisher', () => {
  const harness = createCdcTestHarness({ serviceName: 'advisory-ctrl', eventTypeMap });

  it('publishes DECISION_PACKET_CREATED for DecisionPacket INSERT', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'DecisionPacket', tenantId: 't1' }),
    ]);
    expect(result.publishedEvents[0].type).toBe('DECISION_PACKET_CREATED');
  });

  it('publishes AGENT_INVOCATION_CREATED for AgentInvocation INSERT', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'AgentInvocation', tenantId: 't1' }),
    ]);
    expect(result.publishedEvents[0].type).toBe('AGENT_INVOCATION_CREATED');
  });
});
```

**advisory-bff** (`test/handlers/event-publisher.test.ts`):
```typescript
import { createCdcTestHarness, fakeDdbStreamRecord, buildEventTypeMap } from '@nestfolio/event-processor';

const eventTypeMap = buildEventTypeMap(['DecisionReadModel', 'UserInteraction', 'UserConfirmation', 'UserRejection']);

describe('advisory-bff event-publisher', () => {
  const harness = createCdcTestHarness({ serviceName: 'advisory-bff', eventTypeMap });

  it('publishes DECISION_READ_MODEL_CREATED for DecisionReadModel INSERT', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'DecisionReadModel', tenantId: 't1' }),
    ]);
    expect(result.publishedEvents[0].type).toBe('DECISION_READ_MODEL_CREATED');
  });

  it('publishes USER_CONFIRMATION_CREATED for UserConfirmation INSERT', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'UserConfirmation', tenantId: 't1' }),
    ]);
    expect(result.publishedEvents[0].type).toBe('USER_CONFIRMATION_CREATED');
  });
});
```

**compliance-ctrl** (`test/event-publisher.test.ts`):
```typescript
import { createCdcTestHarness, fakeDdbStreamRecord, buildEventTypeMap } from '@nestfolio/event-processor';

const eventTypeMap = buildEventTypeMap(['ComplianceCheck', 'AuditArtifact']);

describe('compliance-ctrl event-publisher', () => {
  const harness = createCdcTestHarness({ serviceName: 'compliance-ctrl', eventTypeMap });

  it('publishes COMPLIANCE_CHECK_CREATED for ComplianceCheck INSERT', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'ComplianceCheck', tenantId: 't1', status: 'COMPLETED' }),
    ]);
    expect(result.publishedEvents).toHaveLength(1);
    expect(result.publishedEvents[0].type).toBe('COMPLIANCE_CHECK_CREATED');
  });

  it('publishes AUDIT_ARTIFACT_CREATED for AuditArtifact INSERT', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'AuditArtifact', tenantId: 't1' }),
    ]);
    expect(result.publishedEvents[0].type).toBe('AUDIT_ARTIFACT_CREATED');
  });
});
```

- [ ] **Step 2: Run tests → expect FAIL**

Run: `npx nx test advisory-ctrl -- --testPathPattern='event-publisher-cdc' && npx nx test advisory-bff -- --testPathPattern='event-publisher' && npx nx test compliance-ctrl -- --testPathPattern='event-publisher'`

- [ ] **Step 3: Create CDC handlers**

**advisory-ctrl** (`src/handlers/event-publisher-cdc.ts`):
```typescript
import { changeDataCapture, buildEventTypeMap } from '@nestfolio/event-processor';

export const handler = changeDataCapture({
  serviceName: 'advisory-ctrl',
  eventTypeMap: buildEventTypeMap(['DecisionPacket', 'AgentInvocation', 'WorkflowState']),
});
```

**advisory-bff** (`src/handlers/event-publisher.ts`):
```typescript
import { changeDataCapture, buildEventTypeMap } from '@nestfolio/event-processor';

export const handler = changeDataCapture({
  serviceName: 'advisory-bff',
  eventTypeMap: buildEventTypeMap(['DecisionReadModel', 'UserInteraction', 'UserConfirmation', 'UserRejection']),
});
```

**compliance-ctrl** (`src/handlers/event-publisher.ts`):
```typescript
import { changeDataCapture, buildEventTypeMap } from '@nestfolio/event-processor';

export const handler = changeDataCapture({
  serviceName: 'compliance-ctrl',
  eventTypeMap: buildEventTypeMap(['ComplianceCheck', 'AuditArtifact']),
});
```

- [ ] **Step 4: Run tests → expect PASS**

- [ ] **Step 5: Update service stacks**

All three stacks: add `import { join } from 'path'` and set `handlerEntry: join(__dirname, 'handlers/event-publisher.ts')` (or `event-publisher-cdc.ts` for advisory-ctrl) on the Egress construct. Remove `customEventTypeMap` if present.

- [ ] **Step 6: Commit**

```bash
git add services/advisory/
git commit -m "feat(advisory): migrate advisory-ctrl + advisory-bff + compliance-ctrl to event-processor CDC handlers"
```

---

### Task 5: Execution domain CDC handlers

**Files:**
- Create: `services/execution/execution-ctrl/src/handlers/event-publisher.ts`
- Create: `services/execution/execution-ctrl/test/event-publisher.test.ts`
- Modify: `services/execution/execution-ctrl/src/service.stack.ts`
- Create: `services/execution/execution-adpt/src/handlers/event-publisher.ts`
- Create: `services/execution/execution-adpt/test/event-publisher.test.ts`
- Modify: `services/execution/execution-adpt/src/service.stack.ts`

- [ ] **Step 1: Write CDC tests**

**execution-ctrl** (`test/event-publisher.test.ts`):
```typescript
import { createCdcTestHarness, fakeDdbStreamRecord, buildEventTypeMap } from '@nestfolio/event-processor';

const eventTypeMap = buildEventTypeMap(['Order', 'StagedOrder']);

describe('execution-ctrl event-publisher', () => {
  const harness = createCdcTestHarness({ serviceName: 'execution-ctrl', eventTypeMap });

  it('publishes ORDER_CREATED for Order INSERT', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'Order', tenantId: 't1', orderId: 'o1' }),
    ]);
    expect(result.publishedEvents[0].type).toBe('ORDER_CREATED');
  });

  it('publishes ORDER_UPDATED for Order MODIFY', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('MODIFY', { __typename: 'Order', tenantId: 't1', status: 'FILLED' }),
    ]);
    expect(result.publishedEvents[0].type).toBe('ORDER_UPDATED');
  });
});
```

**execution-adpt** (`test/event-publisher.test.ts`):
```typescript
import { createCdcTestHarness, fakeDdbStreamRecord, buildEventTypeMap } from '@nestfolio/event-processor';

const eventTypeMap = buildEventTypeMap(['VirtualTrade', 'VirtualCashBalance', 'VirtualPosition']);

describe('execution-adpt event-publisher', () => {
  const harness = createCdcTestHarness({ serviceName: 'execution-adpt', eventTypeMap });

  it('publishes VIRTUAL_TRADE_CREATED for VirtualTrade INSERT', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'VirtualTrade', tenantId: 't1' }),
    ]);
    expect(result.publishedEvents[0].type).toBe('VIRTUAL_TRADE_CREATED');
  });
});
```

- [ ] **Step 2: Create CDC handlers, run tests, update stacks**

**execution-ctrl** handler:
```typescript
import { changeDataCapture, buildEventTypeMap } from '@nestfolio/event-processor';
export const handler = changeDataCapture({
  serviceName: 'execution-ctrl',
  eventTypeMap: buildEventTypeMap(['Order', 'StagedOrder']),
});
```

**execution-adpt** handler:
```typescript
import { changeDataCapture, buildEventTypeMap } from '@nestfolio/event-processor';
export const handler = changeDataCapture({
  serviceName: 'execution-adpt',
  eventTypeMap: buildEventTypeMap(['VirtualTrade', 'VirtualCashBalance', 'VirtualPosition']),
});
```

Update both stacks with `handlerEntry: join(__dirname, 'handlers/event-publisher.ts')`.

- [ ] **Step 3: Run tests → PASS, commit**

```bash
git add services/execution/
git commit -m "feat(execution): migrate execution-ctrl + execution-adpt to event-processor CDC handlers"
```

---

### Task 6: Ledger domain CDC handlers

**Files:**
- Create: `services/ledger/ledger-ctrl/src/handlers/event-publisher.ts`
- Create: `services/ledger/ledger-ctrl/test/event-publisher.test.ts`
- Modify: `services/ledger/ledger-ctrl/src/service.stack.ts`
- Create: `services/ledger/reconciliation-ctrl/src/handlers/event-publisher.ts`
- Create: `services/ledger/reconciliation-ctrl/test/event-publisher.test.ts`
- Modify: `services/ledger/reconciliation-ctrl/src/service.stack.ts`

- [ ] **Step 1: Write CDC tests**

**ledger-ctrl** (`test/event-publisher.test.ts`):
```typescript
import { createCdcTestHarness, fakeDdbStreamRecord, buildEventTypeMap } from '@nestfolio/event-processor';

const eventTypeMap = buildEventTypeMap(
  ['BalanceEvent', 'PortfolioEvent', 'LedgerEntryEvent'],
  {
    'BalanceEvent:INSERT': 'BALANCE_UPDATED',
    'PortfolioEvent:INSERT': 'PORTFOLIO_UPDATED',
    'LedgerEntryEvent:INSERT': 'LEDGER_ENTRY_RECORDED',
  },
);

describe('ledger-ctrl event-publisher', () => {
  const harness = createCdcTestHarness({ serviceName: 'ledger-ctrl', eventTypeMap });

  it('publishes BALANCE_UPDATED for BalanceEvent INSERT (custom)', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'BalanceEvent', tenantId: 't1' }),
    ]);
    expect(result.publishedEvents[0].type).toBe('BALANCE_UPDATED');
  });

  it('publishes BALANCE_EVENT_UPDATED for BalanceEvent MODIFY (convention)', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('MODIFY', { __typename: 'BalanceEvent', tenantId: 't1' }),
    ]);
    expect(result.publishedEvents[0].type).toBe('BALANCE_EVENT_UPDATED');
  });

  it('publishes PORTFOLIO_UPDATED for PortfolioEvent INSERT (custom)', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'PortfolioEvent', tenantId: 't1' }),
    ]);
    expect(result.publishedEvents[0].type).toBe('PORTFOLIO_UPDATED');
  });

  it('publishes LEDGER_ENTRY_RECORDED for LedgerEntryEvent INSERT (custom)', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'LedgerEntryEvent', tenantId: 't1' }),
    ]);
    expect(result.publishedEvents[0].type).toBe('LEDGER_ENTRY_RECORDED');
  });
});
```

**reconciliation-ctrl** (`test/event-publisher.test.ts`):
```typescript
import { createCdcTestHarness, fakeDdbStreamRecord, buildEventTypeMap } from '@nestfolio/event-processor';

const eventTypeMap = buildEventTypeMap(
  ['ReconciliationResult', 'DriftRecord'],
  {
    'ReconciliationResult:INSERT': 'RECONCILIATION_COMPLETED',
    'DriftRecord:INSERT': 'PORTFOLIO_DRIFT_DETECTED',
  },
);

describe('reconciliation-ctrl event-publisher', () => {
  const harness = createCdcTestHarness({ serviceName: 'reconciliation-ctrl', eventTypeMap });

  it('publishes RECONCILIATION_COMPLETED for ReconciliationResult INSERT', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'ReconciliationResult', tenantId: 't1' }),
    ]);
    expect(result.publishedEvents[0].type).toBe('RECONCILIATION_COMPLETED');
  });

  it('publishes PORTFOLIO_DRIFT_DETECTED for DriftRecord INSERT', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'DriftRecord', tenantId: 't1' }),
    ]);
    expect(result.publishedEvents[0].type).toBe('PORTFOLIO_DRIFT_DETECTED');
  });
});
```

- [ ] **Step 2: Create CDC handlers**

**ledger-ctrl**:
```typescript
import { changeDataCapture, buildEventTypeMap } from '@nestfolio/event-processor';
export const handler = changeDataCapture({
  serviceName: 'ledger-ctrl',
  eventTypeMap: buildEventTypeMap(
    ['BalanceEvent', 'PortfolioEvent', 'LedgerEntryEvent'],
    {
      'BalanceEvent:INSERT': 'BALANCE_UPDATED',
      'PortfolioEvent:INSERT': 'PORTFOLIO_UPDATED',
      'LedgerEntryEvent:INSERT': 'LEDGER_ENTRY_RECORDED',
    },
  ),
});
```

**reconciliation-ctrl**:
```typescript
import { changeDataCapture, buildEventTypeMap } from '@nestfolio/event-processor';
export const handler = changeDataCapture({
  serviceName: 'reconciliation-ctrl',
  eventTypeMap: buildEventTypeMap(
    ['ReconciliationResult', 'DriftRecord'],
    {
      'ReconciliationResult:INSERT': 'RECONCILIATION_COMPLETED',
      'DriftRecord:INSERT': 'PORTFOLIO_DRIFT_DETECTED',
    },
  ),
});
```

- [ ] **Step 3: Update stacks, run tests → PASS, commit**

Both stacks: remove `customEventTypeMap`, add `handlerEntry: join(__dirname, 'handlers/event-publisher.ts')`.

```bash
git add services/ledger/
git commit -m "feat(ledger): migrate ledger-ctrl + reconciliation-ctrl to event-processor CDC handlers"
```

---

## Chunk 3: Event-Listener Migration — Simple + Pipe-Based

### Task 7: investor-ctrl + reconciliation-ctrl event-listeners

These two services delegate ALL events to a single service method: `lifecycleService.process(tenantId, eventType)` / `reconciliationService.process(tenantId, eventType)`. No `toEvent` helper needed.

**Files:**
- Modify: `services/investor/investor-ctrl/src/handlers/event-listener.ts`
- Modify: `services/investor/investor-ctrl/test/event-listener.test.ts`
- Modify: `services/ledger/reconciliation-ctrl/src/handlers/event-listener.ts`
- Modify: `services/ledger/reconciliation-ctrl/test/event-listener.test.ts`

- [ ] **Step 1: Rewrite investor-ctrl test**

```typescript
// services/investor/investor-ctrl/test/event-listener.test.ts
import { createTestHarness, fakeSqsRecord } from '@nestfolio/event-processor';
import { createHandlers, type EventListenerDeps } from '../src/handlers/event-listener';

describe('investor-ctrl event-listener', () => {
  const mockLifecycleService = { process: jest.fn().mockResolvedValue(undefined) };
  const mockDeps: EventListenerDeps = {
    lifecycleService: mockLifecycleService as any,
  };

  const harness = createTestHarness({
    serviceName: 'investor-ctrl',
    handlers: createHandlers(mockDeps),
  });

  beforeEach(() => jest.clearAllMocks());

  it('routes ONBOARDING_COMPLETED to lifecycle service', async () => {
    const result = await harness.process([
      fakeSqsRecord('ONBOARDING_COMPLETED', { userId: 'u1' }, { tenantId: 't1' }),
    ]);
    expect(result.skipped).toBe(1);
    expect(mockLifecycleService.process).toHaveBeenCalledWith('t1', 'ONBOARDING_COMPLETED');
  });

  it('routes ORDER_FILLED to lifecycle service', async () => {
    await harness.process([
      fakeSqsRecord('ORDER_FILLED', { orderId: 'o1' }, { tenantId: 't1' }),
    ]);
    expect(mockLifecycleService.process).toHaveBeenCalledWith('t1', 'ORDER_FILLED');
  });

  it('handles all 8 event types', async () => {
    const types = [
      'ONBOARDING_COMPLETED', 'MANDATE_GRANTED', 'GOAL_UPDATED', 'DEPOSIT_INITIATED',
      'OPERATING_MODE_CHANGED', 'DECISION_APPROVED', 'ORDER_FILLED', 'BALANCE_UPDATED',
    ];
    for (const type of types) {
      jest.clearAllMocks();
      await harness.process([fakeSqsRecord(type, {}, { tenantId: 't1' })]);
      expect(mockLifecycleService.process).toHaveBeenCalledWith('t1', type);
    }
  });
});
```

- [ ] **Step 2: Rewrite investor-ctrl handler**

```typescript
// services/investor/investor-ctrl/src/handlers/event-listener.ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { createEventHandler, skip, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { requireEnv } from '@nestfolio/lambda-utils';
import { NotificationRepository } from '../repositories/notification.repository';
import { NotificationLifecycleService } from '../services/notification-lifecycle.service';
import { NotificationDeliveryService } from '../services/notification-delivery.service';

export interface EventListenerDeps {
  readonly lifecycleService: NotificationLifecycleService;
}

const EVENT_TYPES = [
  'ONBOARDING_COMPLETED', 'MANDATE_GRANTED', 'GOAL_UPDATED', 'DEPOSIT_INITIATED',
  'OPERATING_MODE_CHANGED', 'DECISION_APPROVED', 'ORDER_FILLED', 'BALANCE_UPDATED',
] as const;

export const createHandlers = (deps: EventListenerDeps) =>
  Object.fromEntries(
    EVENT_TYPES.map((type) => [
      type,
      async (_payload: EventPayload, ctx: EventContext) => {
        await deps.lifecycleService.process(ctx.tenantId, ctx.eventType);
        return skip();
      },
    ]),
  );

// Production wiring
const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new NotificationRepository(TABLE_NAME, dynamoClient);
const deliveryService = new NotificationDeliveryService();
const lifecycleService = new NotificationLifecycleService(repository, deliveryService);

const deps: EventListenerDeps = { lifecycleService };

export const handler = createEventHandler({
  serviceName: 'investor-ctrl',
  handlers: createHandlers(deps),
  table: TABLE_NAME,
  bus: requireEnv('BUS_NAME'),
  errorEventType: 'INVESTOR_CTRL_FAILED',
});
```

- [ ] **Step 3: Rewrite reconciliation-ctrl (same pattern)**

Handler (`event-listener.ts`):
```typescript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { createEventHandler, skip, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { requireEnv } from '@nestfolio/lambda-utils';
import { ReconciliationRepository } from '../repositories/reconciliation.repository';
import { ReconciliationService } from '../services/reconciliation.service';

export interface EventListenerDeps {
  readonly reconciliationService: ReconciliationService;
}

const EVENT_TYPES = ['PORTFOLIO_UPDATED', 'PORTFOLIO_SNAPSHOT_IMPORTED', 'CORPORATE_ACTION_APPLIED'] as const;

export const createHandlers = (deps: EventListenerDeps) =>
  Object.fromEntries(
    EVENT_TYPES.map((type) => [
      type,
      async (_payload: EventPayload, ctx: EventContext) => {
        await deps.reconciliationService.process(ctx.tenantId, ctx.eventType);
        return skip();
      },
    ]),
  );

// Production wiring
const TABLE_NAME = requireEnv('TABLE_NAME');
const repository = new ReconciliationRepository(TABLE_NAME, new DynamoDBClient({}));
const reconciliationService = new ReconciliationService(repository);
const deps: EventListenerDeps = { reconciliationService };

export const handler = createEventHandler({
  serviceName: 'reconciliation-ctrl',
  handlers: createHandlers(deps),
  table: TABLE_NAME,
  bus: requireEnv('BUS_NAME'),
  errorEventType: 'RECONCILIATION_CTRL_FAILED',
});
```

Test (`test/event-listener.test.ts`):
```typescript
import { createTestHarness, fakeSqsRecord } from '@nestfolio/event-processor';
import { createHandlers, type EventListenerDeps } from '../src/handlers/event-listener';

describe('reconciliation-ctrl event-listener', () => {
  const mockService = { process: jest.fn().mockResolvedValue(undefined) };
  const deps: EventListenerDeps = { reconciliationService: mockService as any };
  const harness = createTestHarness({ serviceName: 'reconciliation-ctrl', handlers: createHandlers(deps) });

  beforeEach(() => jest.clearAllMocks());

  it('routes PORTFOLIO_UPDATED to reconciliation service', async () => {
    const result = await harness.process([
      fakeSqsRecord('PORTFOLIO_UPDATED', {}, { tenantId: 't1' }),
    ]);
    expect(result.skipped).toBe(1);
    expect(mockService.process).toHaveBeenCalledWith('t1', 'PORTFOLIO_UPDATED');
  });
});
```

- [ ] **Step 4: Run tests → PASS**

Run: `npx nx test investor-ctrl -- --testPathPattern='event-listener' && npx nx test reconciliation-ctrl -- --testPathPattern='event-listener'`

- [ ] **Step 5: Commit**

```bash
git add services/investor/investor-ctrl/src/handlers/event-listener.ts services/investor/investor-ctrl/test/event-listener.test.ts services/ledger/reconciliation-ctrl/src/handlers/event-listener.ts services/ledger/reconciliation-ctrl/test/event-listener.test.ts
git commit -m "feat(investor-ctrl,reconciliation-ctrl): migrate event-listeners to event-processor"
```

---

### Task 8: execution-ctrl + execution-adpt event-listeners

These services use switch/case routing with dedicated handler functions. They need the `toEvent` helper since their service methods accept the full event object.

**Files:**
- Modify: `services/execution/execution-ctrl/src/handlers/event-listener.ts`
- Modify: `services/execution/execution-ctrl/test/event-listener.test.ts`
- Modify: `services/execution/execution-adpt/src/handlers/event-listener.ts`
- Modify: `services/execution/execution-adpt/test/event-listener.test.ts`

- [ ] **Step 1: Rewrite execution-ctrl handler**

```typescript
// services/execution/execution-ctrl/src/handlers/event-listener.ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { createEventHandler, skip, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { logger } from '@nestfolio/platform-core';
import { requireEnv } from '@nestfolio/lambda-utils';
import { OrderRepository } from '../repositories/order.repository';
import { SafetyChecksService } from '../services/safety-checks.service';
import { MarketHoursService } from '../services/market-hours.service';
import { OrderLifecycleService } from '../services/order-lifecycle.service';

export interface EventListenerDeps {
  readonly lifecycleService: OrderLifecycleService;
}

function toEvent(payload: EventPayload, ctx: EventContext): Record<string, unknown> {
  return { id: ctx.eventId, type: ctx.eventType, timestamp: ctx.timestamp,
    subject: payload.subject, context: payload.context ?? { tenantId: ctx.tenantId } };
}

export const createHandlers = (deps: EventListenerDeps) => ({
  'DECISION_APPROVED': async (payload: EventPayload, ctx: EventContext) => {
    await deps.lifecycleService.processApprovedDecision(toEvent(payload, ctx));
    return skip();
  },
  'USER_CONFIRMED': async (payload: EventPayload, ctx: EventContext) => {
    await deps.lifecycleService.processApprovedDecision(toEvent(payload, ctx));
    return skip();
  },
  'CIRCUIT_BREAKER_TRIGGERED': async (_payload: EventPayload, ctx: EventContext) => {
    logger.info('Circuit breaker triggered — execution paused', { eventId: ctx.eventId });
    return skip();
  },
  'CIRCUIT_BREAKER_RESET': async (_payload: EventPayload, ctx: EventContext) => {
    logger.info('Circuit breaker reset — execution resumed', { eventId: ctx.eventId });
    return skip();
  },
  'ACCOUNT_CLOSURE_REQUESTED': async (_payload: EventPayload, ctx: EventContext) => {
    logger.info('Account closure requested', { eventId: ctx.eventId });
    return skip();
  },
});

// Production wiring
const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new OrderRepository(TABLE_NAME, dynamoClient);
const safetyChecks = new SafetyChecksService(repository);
const marketHours = new MarketHoursService();
const lifecycleService = new OrderLifecycleService(repository, safetyChecks, marketHours);
const deps: EventListenerDeps = { lifecycleService };

export const handler = createEventHandler({
  serviceName: 'execution-ctrl',
  handlers: createHandlers(deps),
  table: TABLE_NAME,
  bus: requireEnv('BUS_NAME'),
  errorEventType: 'EXECUTION_CTRL_FAILED',
});
```

- [ ] **Step 2: Rewrite execution-ctrl test**

```typescript
// services/execution/execution-ctrl/test/event-listener.test.ts
import { createTestHarness, fakeSqsRecord } from '@nestfolio/event-processor';
import { createHandlers, type EventListenerDeps } from '../src/handlers/event-listener';

describe('execution-ctrl event-listener', () => {
  const mockLifecycle = { processApprovedDecision: jest.fn().mockResolvedValue(undefined) };
  const deps: EventListenerDeps = { lifecycleService: mockLifecycle as any };
  const harness = createTestHarness({ serviceName: 'execution-ctrl', handlers: createHandlers(deps) });

  beforeEach(() => jest.clearAllMocks());

  it('routes DECISION_APPROVED to lifecycle service', async () => {
    const result = await harness.process([
      fakeSqsRecord('DECISION_APPROVED', { orderId: 'o1' }, { tenantId: 't1', eventId: 'e1' }),
    ]);
    expect(result.skipped).toBe(1);
    expect(mockLifecycle.processApprovedDecision).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'e1', type: 'DECISION_APPROVED', subject: { orderId: 'o1' } }),
    );
  });

  it('handles CIRCUIT_BREAKER_TRIGGERED without calling lifecycle', async () => {
    const result = await harness.process([
      fakeSqsRecord('CIRCUIT_BREAKER_TRIGGERED', {}, { tenantId: 't1' }),
    ]);
    expect(result.skipped).toBe(1);
    expect(mockLifecycle.processApprovedDecision).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Rewrite execution-adpt handler**

```typescript
// services/execution/execution-adpt/src/handlers/event-listener.ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { createEventHandler, skip, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { logger, NotRetryableError } from '@nestfolio/platform-core';
import { requireEnv } from '@nestfolio/lambda-utils';
import { VirtualLedgerRepository } from '../repositories/virtual-ledger.repository';
import { MarketDataService } from '../services/market-data.service';
import { SimulationEngineService } from '../services/simulation-engine.service';

export interface EventListenerDeps {
  readonly repository: VirtualLedgerRepository;
  readonly simulationEngine: SimulationEngineService;
}

export const createHandlers = (deps: EventListenerDeps) => ({
  'ORDER_SUBMITTED': async (payload: EventPayload, ctx: EventContext) => {
    const subject = payload.subject;
    if (!subject) throw new NotRetryableError(`Missing subject in ORDER_SUBMITTED event ${ctx.eventId}`);
    const tenantId = ctx.tenantId;
    const userId = (subject.userId as string) ?? tenantId;
    const orderId = subject.orderId as string;
    const symbol = subject.symbol as string;
    const side = subject.side as 'BUY' | 'SELL';
    const quantity = subject.quantity as number;
    if (!orderId || !symbol || !side || quantity === undefined) {
      throw new NotRetryableError(`Missing required ORDER_SUBMITTED fields: orderId=${orderId}, symbol=${symbol}, side=${side}, quantity=${quantity}`);
    }
    const cashBalance = await deps.repository.getCashBalance(tenantId, userId, 'USD');
    if (!cashBalance) await deps.simulationEngine.initializeAccount(tenantId, userId);
    try {
      const result = await deps.simulationEngine.processOrderSubmitted(tenantId, userId, orderId, symbol, side, quantity);
      logger.info('Order simulation complete', { orderId, status: result.status, fillPrice: result.fillPrice, rejectReason: result.rejectReason });
    } catch (error) {
      if ((error as Error).name === 'TransactionCanceledException') {
        logger.info('Order already processed, skipping', { orderId, eventId: ctx.eventId });
        return skip();
      }
      throw error;
    }
    return skip();
  },
  'WITHDRAWAL_REQUESTED': async (payload: EventPayload, ctx: EventContext) => {
    const subject = payload.subject;
    if (!subject) throw new NotRetryableError(`Missing subject in WITHDRAWAL_REQUESTED event ${ctx.eventId}`);
    const tenantId = ctx.tenantId;
    const userId = (subject.userId as string) ?? tenantId;
    const withdrawalId = subject.withdrawalId as string;
    const amount = subject.amount as number;
    if (!withdrawalId || amount === undefined) {
      throw new NotRetryableError(`Missing required WITHDRAWAL_REQUESTED fields: withdrawalId=${withdrawalId}, amount=${amount}`);
    }
    const cashBalance = await deps.repository.getCashBalance(tenantId, userId, 'USD');
    const balance = (cashBalance?.balance as number) ?? 0;
    if (balance < amount) {
      logger.info('Withdrawal rejected: insufficient cash', { withdrawalId, balance, amount });
      return skip();
    }
    const processed = await deps.repository.guardedAddToCashBalance(tenantId, userId, 'USD', -amount, ctx.eventId);
    if (!processed) {
      logger.info('Withdrawal already processed, skipping', { eventId: ctx.eventId });
      return skip();
    }
    logger.info('Withdrawal completed', { withdrawalId, amount, newBalance: balance - amount });
    return skip();
  },
  'DEPOSIT_INITIATED': async (payload: EventPayload, ctx: EventContext) => {
    const subject = payload.subject;
    if (!subject) throw new NotRetryableError(`Missing subject in DEPOSIT_INITIATED event ${ctx.eventId}`);
    const tenantId = ctx.tenantId;
    const userId = (subject.userId as string) ?? tenantId;
    const depositId = subject.depositId as string;
    const amountCents = subject.amountCents as number;
    const currency = (subject.currency as string) ?? 'USD';
    if (!depositId || amountCents === undefined) {
      throw new NotRetryableError(`Missing required DEPOSIT_INITIATED fields: depositId=${depositId}, amountCents=${amountCents}`);
    }
    const amount = amountCents / 100;
    const cashBalance = await deps.repository.getCashBalance(tenantId, userId, currency);
    if (!cashBalance) await deps.simulationEngine.initializeAccount(tenantId, userId);
    const processed = await deps.repository.guardedAddToCashBalance(tenantId, userId, currency, amount, ctx.eventId);
    if (!processed) {
      logger.info('Deposit already processed, skipping', { eventId: ctx.eventId });
      return skip();
    }
    logger.info('Deposit processed', { depositId, amount, tenantId });
    return skip();
  },
});

// Production wiring
const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new VirtualLedgerRepository(TABLE_NAME, dynamoClient);
const marketData = new MarketDataService();
const simulationEngine = new SimulationEngineService(repository, marketData);
const deps: EventListenerDeps = { repository, simulationEngine };

export const handler = createEventHandler({
  serviceName: 'execution-adpt',
  handlers: createHandlers(deps),
  table: TABLE_NAME,
  bus: requireEnv('BUS_NAME'),
  errorEventType: 'EXECUTION_ADPT_FAILED',
});
```

- [ ] **Step 3b: Rewrite execution-adpt test**

```typescript
// services/execution/execution-adpt/test/event-listener.test.ts
import { createTestHarness, fakeSqsRecord } from '@nestfolio/event-processor';
import { createHandlers, type EventListenerDeps } from '../src/handlers/event-listener';

describe('execution-adpt event-listener', () => {
  const mockRepo = {
    getCashBalance: jest.fn().mockResolvedValue({ balance: 10000 }),
    guardedAddToCashBalance: jest.fn().mockResolvedValue(true),
  };
  const mockEngine = {
    initializeAccount: jest.fn().mockResolvedValue(undefined),
    processOrderSubmitted: jest.fn().mockResolvedValue({ status: 'FILLED', fillPrice: 150 }),
  };
  const deps: EventListenerDeps = { repository: mockRepo as any, simulationEngine: mockEngine as any };
  const harness = createTestHarness({ serviceName: 'execution-adpt', handlers: createHandlers(deps) });

  beforeEach(() => jest.clearAllMocks());

  it('processes ORDER_SUBMITTED through simulation engine', async () => {
    const result = await harness.process([
      fakeSqsRecord('ORDER_SUBMITTED', {
        orderId: 'o1', symbol: 'AAPL', side: 'BUY', quantity: 10, userId: 'u1',
      }, { tenantId: 't1', eventId: 'e1' }),
    ]);
    expect(result.skipped).toBe(1);
    expect(mockEngine.processOrderSubmitted).toHaveBeenCalledWith('t1', 'u1', 'o1', 'AAPL', 'BUY', 10);
  });

  it('processes DEPOSIT_INITIATED with guarded credit', async () => {
    await harness.process([
      fakeSqsRecord('DEPOSIT_INITIATED', {
        depositId: 'd1', amountCents: 50000, userId: 'u1',
      }, { tenantId: 't1', eventId: 'e1' }),
    ]);
    expect(mockRepo.guardedAddToCashBalance).toHaveBeenCalledWith('t1', 'u1', 'USD', 500, 'e1');
  });

  it('skips duplicate withdrawals', async () => {
    mockRepo.guardedAddToCashBalance.mockResolvedValue(false);
    const result = await harness.process([
      fakeSqsRecord('WITHDRAWAL_REQUESTED', {
        withdrawalId: 'w1', amount: 100, userId: 'u1',
      }, { tenantId: 't1', eventId: 'e1' }),
    ]);
    expect(result.skipped).toBe(1);
  });
});
```

- [ ] **Step 4: Run tests → PASS**

Run: `npx nx test execution-ctrl -- --testPathPattern='event-listener' && npx nx test execution-adpt -- --testPathPattern='event-listener'`

- [ ] **Step 5: Commit**

```bash
git add services/execution/
git commit -m "feat(execution): migrate execution-ctrl + execution-adpt event-listeners to event-processor"
```

---

### Task 9: investor-bff + advisory-bff event-listeners (pipe-based)

These services route events to pipes. Each pipe has a `process(event)` method that does its own DDB writes.

**Files:**
- Modify: `services/investor/investor-bff/src/handlers/event-listener.ts`
- Modify: `services/investor/investor-bff/test/handlers/event-listener.test.ts`
- Modify: `services/advisory/advisory-bff/src/handlers/event-listener.ts`
- Modify: `services/advisory/advisory-bff/test/event-listener.test.ts`

- [ ] **Step 1: Rewrite investor-bff handler**

```typescript
// services/investor/investor-bff/src/handlers/event-listener.ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { createEventHandler, skip, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { requireEnv } from '@nestfolio/lambda-utils';
import { InvestorProfileRepository } from '../repositories/investor-profile.repository';
// ... pipe imports ...

export interface EventListenerDeps {
  readonly userRegisteredPipe: { process: (event: Record<string, unknown>) => Promise<void> };
  readonly notificationCreatedPipe: { process: (event: Record<string, unknown>) => Promise<void> };
  readonly balanceUpdatedPipe: { process: (event: Record<string, unknown>) => Promise<void> };
}

function toEvent(payload: EventPayload, ctx: EventContext): Record<string, unknown> {
  return { id: ctx.eventId, type: ctx.eventType, timestamp: ctx.timestamp,
    subject: payload.subject, context: payload.context ?? { tenantId: ctx.tenantId } };
}

export const createHandlers = (deps: EventListenerDeps) => ({
  'USER_REGISTERED': async (payload: EventPayload, ctx: EventContext) => {
    await deps.userRegisteredPipe.process(toEvent(payload, ctx));
    return skip();
  },
  'NOTIFICATION_CREATED': async (payload: EventPayload, ctx: EventContext) => {
    await deps.notificationCreatedPipe.process(toEvent(payload, ctx));
    return skip();
  },
  'BALANCE_UPDATED': async (payload: EventPayload, ctx: EventContext) => {
    await deps.balanceUpdatedPipe.process(toEvent(payload, ctx));
    return skip();
  },
});

// Production wiring (keep existing pipe creation, remove bus/metrics)
const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new InvestorProfileRepository(TABLE_NAME, dynamoClient);
// ... pipe creation stays the same ...

const deps: EventListenerDeps = { userRegisteredPipe, notificationCreatedPipe, balanceUpdatedPipe };

export const handler = createEventHandler({
  serviceName: 'investor-bff',
  handlers: createHandlers(deps),
  table: TABLE_NAME,
  bus: requireEnv('BUS_NAME'),
  errorEventType: 'INVESTOR_BFF_FAILED',
});
```

- [ ] **Step 2: Rewrite investor-bff test**

```typescript
import { createTestHarness, fakeSqsRecord } from '@nestfolio/event-processor';
import { createHandlers, type EventListenerDeps } from '../../src/handlers/event-listener';

describe('investor-bff event-listener', () => {
  const mockPipes = {
    userRegisteredPipe: { process: jest.fn().mockResolvedValue(undefined) },
    notificationCreatedPipe: { process: jest.fn().mockResolvedValue(undefined) },
    balanceUpdatedPipe: { process: jest.fn().mockResolvedValue(undefined) },
  };
  const deps: EventListenerDeps = mockPipes as any;
  const harness = createTestHarness({ serviceName: 'investor-bff', handlers: createHandlers(deps) });

  beforeEach(() => jest.clearAllMocks());

  it('routes USER_REGISTERED to userRegisteredPipe', async () => {
    const result = await harness.process([
      fakeSqsRecord('USER_REGISTERED', { email: 'a@b.com' }, { tenantId: 't1' }),
    ]);
    expect(result.skipped).toBe(1);
    expect(mockPipes.userRegisteredPipe.process).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'USER_REGISTERED', subject: { email: 'a@b.com' } }),
    );
  });

  it('routes BALANCE_UPDATED to balanceUpdatedPipe', async () => {
    await harness.process([
      fakeSqsRecord('BALANCE_UPDATED', { amount: 1000 }, { tenantId: 't1' }),
    ]);
    expect(mockPipes.balanceUpdatedPipe.process).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Rewrite advisory-bff handler + test**

Same pattern. Handler routes to `decisionPacketCreatedPipe` and `decisionStatusChangedPipe`. Deps:
```typescript
export interface EventListenerDeps {
  readonly decisionPacketCreatedPipe: { process: (event: Record<string, unknown>) => Promise<void> };
  readonly decisionStatusChangedPipe: { process: (event: Record<string, unknown>) => Promise<void> };
}

export const createHandlers = (deps: EventListenerDeps) => ({
  'DECISION_PACKET_CREATED': async (payload: EventPayload, ctx: EventContext) => {
    await deps.decisionPacketCreatedPipe.process(toEvent(payload, ctx));
    return skip();
  },
  'DECISION_PACKET_ENRICHED': async (payload: EventPayload, ctx: EventContext) => {
    await deps.decisionStatusChangedPipe.process(toEvent(payload, ctx));
    return skip();
  },
  'DECISION_APPROVED': async (payload: EventPayload, ctx: EventContext) => {
    await deps.decisionStatusChangedPipe.process(toEvent(payload, ctx));
    return skip();
  },
  'DECISION_BLOCKED': async (payload: EventPayload, ctx: EventContext) => {
    await deps.decisionStatusChangedPipe.process(toEvent(payload, ctx));
    return skip();
  },
  'USER_CONFIRMATION_REQUESTED': async (payload: EventPayload, ctx: EventContext) => {
    await deps.decisionStatusChangedPipe.process(toEvent(payload, ctx));
    return skip();
  },
});
```

- [ ] **Step 4: Run tests → PASS, commit**

```bash
git add services/investor/investor-bff/ services/advisory/advisory-bff/
git commit -m "feat(investor-bff,advisory-bff): migrate pipe-based event-listeners to event-processor"
```

---

### Task 10: dashboard-bff + ledger-bff event-listeners (eventPipeMap-based)

These services use a `Record<string, NamedPipe[]>` map to dispatch events to multiple pipes per event type.

**Files:**
- Modify: `services/investor/dashboard-bff/src/handlers/event-listener.ts`
- Modify: `services/investor/dashboard-bff/test/handlers/event-listener.test.ts`
- Modify: `services/ledger/ledger-bff/src/handlers/event-listener.ts`
- Modify: `services/ledger/ledger-bff/test/handlers/event-listener.test.ts`

- [ ] **Step 1: Rewrite dashboard-bff handler**

```typescript
// services/investor/dashboard-bff/src/handlers/event-listener.ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { createEventHandler, skip, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { requireEnv } from '@nestfolio/lambda-utils';
import { DashboardRepository } from '../repositories/dashboard.repository';
// ... pipe imports ...

export interface NamedPipe {
  readonly name: string;
  process(event: Record<string, unknown>): Promise<void>;
}

export interface EventListenerDeps {
  readonly eventPipeMap: Record<string, NamedPipe[]>;
}

function toEvent(payload: EventPayload, ctx: EventContext): Record<string, unknown> {
  return { id: ctx.eventId, type: ctx.eventType, timestamp: ctx.timestamp,
    subject: payload.subject, context: payload.context ?? { tenantId: ctx.tenantId } };
}

export const createHandlers = (deps: EventListenerDeps) => {
  const handlers: Record<string, (payload: EventPayload, ctx: EventContext) => Promise<ReturnType<typeof skip>>> = {};

  for (const eventType of Object.keys(deps.eventPipeMap)) {
    handlers[eventType] = async (payload: EventPayload, ctx: EventContext) => {
      const event = toEvent(payload, ctx);
      const pipes = deps.eventPipeMap[ctx.eventType];
      for (const pipe of pipes) {
        await pipe.process(event);
      }
      return skip();
    };
  }

  return handlers;
};

// Production wiring (keep existing pipe + eventPipeMap creation, remove bus/metrics)
// ... existing pipe creation code ...

const deps: EventListenerDeps = { eventPipeMap };

export const handler = createEventHandler({
  serviceName: 'dashboard-bff',
  handlers: createHandlers(deps),
  table: requireEnv('TABLE_NAME'),
  bus: requireEnv('BUS_NAME'),
  errorEventType: 'DASHBOARD_BFF_FAILED',
});
```

- [ ] **Step 2: Rewrite dashboard-bff test**

```typescript
import { createTestHarness, fakeSqsRecord } from '@nestfolio/event-processor';
import { createHandlers, type EventListenerDeps, type NamedPipe } from '../../src/handlers/event-listener';

describe('dashboard-bff event-listener', () => {
  const mockPipe1: NamedPipe = { name: 'pipe1', process: jest.fn().mockResolvedValue(undefined) };
  const mockPipe2: NamedPipe = { name: 'pipe2', process: jest.fn().mockResolvedValue(undefined) };

  const deps: EventListenerDeps = {
    eventPipeMap: {
      'PORTFOLIO_SUMMARY': [mockPipe1],
      'POSITION_SNAPSHOT': [mockPipe1, mockPipe2],
    },
  };

  const harness = createTestHarness({ serviceName: 'dashboard-bff', handlers: createHandlers(deps) });

  beforeEach(() => jest.clearAllMocks());

  it('routes PORTFOLIO_SUMMARY to its pipe', async () => {
    const result = await harness.process([
      fakeSqsRecord('PORTFOLIO_SUMMARY', { total: 50000 }, { tenantId: 't1' }),
    ]);
    expect(result.skipped).toBe(1);
    expect(mockPipe1.process).toHaveBeenCalled();
  });

  it('routes POSITION_SNAPSHOT to all its pipes', async () => {
    await harness.process([
      fakeSqsRecord('POSITION_SNAPSHOT', {}, { tenantId: 't1' }),
    ]);
    expect(mockPipe1.process).toHaveBeenCalled();
    expect(mockPipe2.process).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Rewrite ledger-bff handler**

```typescript
// services/ledger/ledger-bff/src/handlers/event-listener.ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { createEventHandler, skip, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { logger, type BusEvent, type Pipe, type UnitOfWork } from '@nestfolio/platform-core';
import { requireEnv } from '@nestfolio/lambda-utils';
import { PortfolioRepository } from '../repositories/portfolio.repository';
import { BalanceUpdatedPipe } from '../pipes/balance-updated.pipe';
import { PortfolioUpdatedPipe } from '../pipes/portfolio-updated.pipe';
import { LedgerEntryRecordedPipe } from '../pipes/ledger-entry-recorded.pipe';

export interface NamedPipe {
  readonly name: string;
  readonly pipe: Pipe<UnitOfWork<BusEvent<Record<string, unknown>>>>;
}

export interface EventListenerDeps {
  readonly eventPipeMap: Record<string, NamedPipe[]>;
}

function toEvent(payload: EventPayload, ctx: EventContext): Record<string, unknown> {
  return { id: ctx.eventId, type: ctx.eventType, timestamp: ctx.timestamp,
    subject: payload.subject, context: payload.context ?? { tenantId: ctx.tenantId } };
}

export const createHandlers = (deps: EventListenerDeps) => {
  const handlers: Record<string, (payload: EventPayload, ctx: EventContext) => Promise<ReturnType<typeof skip>>> = {};

  for (const eventType of Object.keys(deps.eventPipeMap)) {
    handlers[eventType] = async (payload: EventPayload, ctx: EventContext) => {
      const event = toEvent(payload, ctx);
      const namedPipes = deps.eventPipeMap[ctx.eventType];
      if (!namedPipes || namedPipes.length === 0) {
        logger.info('No pipes for event type, skipping', { eventType: ctx.eventType });
        return skip();
      }
      for (const { pipe } of namedPipes) {
        await pipe.process({ event } as any);
      }
      return skip();
    };
  }

  return handlers;
};

// Production wiring
const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new PortfolioRepository(TABLE_NAME, dynamoClient);

const EVENT_PIPE_MAP: Record<string, NamedPipe[]> = {
  BALANCE_UPDATED: [{ name: 'balanceUpdated', pipe: new BalanceUpdatedPipe(repository) }],
  PORTFOLIO_UPDATED: [{ name: 'portfolioUpdated', pipe: new PortfolioUpdatedPipe(repository) }],
  LEDGER_ENTRY_RECORDED: [{ name: 'ledgerEntryRecorded', pipe: new LedgerEntryRecordedPipe(repository) }],
};

const deps: EventListenerDeps = { eventPipeMap: EVENT_PIPE_MAP };

export const handler = createEventHandler({
  serviceName: 'ledger-bff',
  handlers: createHandlers(deps),
  table: TABLE_NAME,
  bus: requireEnv('BUS_NAME'),
  errorEventType: 'LEDGER_BFF_FAILED',
});
```

- [ ] **Step 3b: Rewrite ledger-bff test**

```typescript
// services/ledger/ledger-bff/test/handlers/event-listener.test.ts
import { createTestHarness, fakeSqsRecord } from '@nestfolio/event-processor';
import { createHandlers, type EventListenerDeps, type NamedPipe } from '../../src/handlers/event-listener';

describe('ledger-bff event-listener', () => {
  const mockPipe1 = { name: 'balanceUpdated', pipe: { process: jest.fn().mockResolvedValue(undefined) } };
  const mockPipe2 = { name: 'portfolioUpdated', pipe: { process: jest.fn().mockResolvedValue(undefined) } };
  const mockPipe3 = { name: 'ledgerEntryRecorded', pipe: { process: jest.fn().mockResolvedValue(undefined) } };

  const deps: EventListenerDeps = {
    eventPipeMap: {
      'BALANCE_UPDATED': [mockPipe1 as any],
      'PORTFOLIO_UPDATED': [mockPipe2 as any],
      'LEDGER_ENTRY_RECORDED': [mockPipe3 as any],
    },
  };

  const harness = createTestHarness({ serviceName: 'ledger-bff', handlers: createHandlers(deps) });

  beforeEach(() => jest.clearAllMocks());

  it('routes BALANCE_UPDATED to balanceUpdated pipe', async () => {
    const result = await harness.process([
      fakeSqsRecord('BALANCE_UPDATED', { amount: 1000 }, { tenantId: 't1' }),
    ]);
    expect(result.skipped).toBe(1);
    expect(mockPipe1.pipe.process).toHaveBeenCalled();
  });

  it('routes PORTFOLIO_UPDATED to portfolioUpdated pipe', async () => {
    await harness.process([
      fakeSqsRecord('PORTFOLIO_UPDATED', { value: 50000 }, { tenantId: 't1' }),
    ]);
    expect(mockPipe2.pipe.process).toHaveBeenCalled();
  });

  it('routes LEDGER_ENTRY_RECORDED to ledgerEntryRecorded pipe', async () => {
    await harness.process([
      fakeSqsRecord('LEDGER_ENTRY_RECORDED', { entryId: 'le1' }, { tenantId: 't1' }),
    ]);
    expect(mockPipe3.pipe.process).toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run tests → PASS, commit**

```bash
git add services/investor/dashboard-bff/ services/ledger/ledger-bff/
git commit -m "feat(dashboard-bff,ledger-bff): migrate eventPipeMap-based event-listeners to event-processor"
```

---

## Chunk 4: Event-Listener Migration — Complex + Cleanup

### Task 11: advisory-ctrl event-listener

advisory-ctrl has 15 event types across 3 groups (trigger, compliance, user-response), each delegating to different service/repository methods.

**Files:**
- Modify: `services/advisory/advisory-ctrl/src/handlers/event-listener.ts`
- Modify: `services/advisory/advisory-ctrl/test/event-listener.test.ts`

- [ ] **Step 1: Rewrite advisory-ctrl handler**

```typescript
// services/advisory/advisory-ctrl/src/handlers/event-listener.ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { createEventHandler, skip, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { requireEnv } from '@nestfolio/lambda-utils';
import { DecisionRepository } from '../repositories/decision.repository';
import { DecisionLifecycleService } from '../services/decision-lifecycle.service';

export interface EventListenerDeps {
  readonly lifecycleService: DecisionLifecycleService;
  readonly repository: DecisionRepository;
}

function toEvent(payload: EventPayload, ctx: EventContext): Record<string, unknown> {
  return { id: ctx.eventId, type: ctx.eventType, timestamp: ctx.timestamp,
    subject: payload.subject, context: payload.context ?? { tenantId: ctx.tenantId } };
}

const TRIGGER_TYPES = [
  'MANDATE_GRANTED', 'GOAL_UPDATED', 'RISK_PROFILE_UPDATED', 'OPERATING_MODE_CHANGED',
  'PORTFOLIO_DRIFT_DETECTED', 'ORDER_FILLED', 'ORDER_REJECTED', 'ORDER_CANCELLED', 'DEPOSIT_DETECTED',
] as const;

export const createHandlers = (deps: EventListenerDeps) => {
  const handlers: Record<string, (payload: EventPayload, ctx: EventContext) => Promise<ReturnType<typeof skip>>> = {};

  // Trigger events → lifecycle service
  for (const type of TRIGGER_TYPES) {
    handlers[type] = async (payload, ctx) => {
      await deps.lifecycleService.processTriggerEvent(toEvent(payload, ctx));
      return skip();
    };
  }

  // Compliance callback events
  handlers['DECISION_APPROVED'] = async (payload, ctx) => {
    await deps.lifecycleService.processComplianceEvent(toEvent(payload, ctx));
    return skip();
  };
  handlers['DECISION_BLOCKED'] = async (payload, ctx) => {
    await deps.lifecycleService.processComplianceEvent(toEvent(payload, ctx));
    return skip();
  };

  // User response events
  handlers['USER_CONFIRMED'] = async (payload, ctx) => {
    await deps.lifecycleService.processUserResponse(toEvent(payload, ctx), ctx.eventType);
    return skip();
  };
  handlers['USER_REJECTED'] = async (payload, ctx) => {
    await deps.lifecycleService.processUserResponse(toEvent(payload, ctx), ctx.eventType);
    return skip();
  };

  return handlers;
};

// Production wiring
const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new DecisionRepository(TABLE_NAME, dynamoClient);
const lifecycleService = new DecisionLifecycleService(repository);
const deps: EventListenerDeps = { lifecycleService, repository };

export const handler = createEventHandler({
  serviceName: 'advisory-ctrl',
  handlers: createHandlers(deps),
  table: TABLE_NAME,
  bus: requireEnv('BUS_NAME'),
  errorEventType: 'ADVISORY_CTRL_FAILED',
});
```

- [ ] **Step 2: Rewrite advisory-ctrl test**

```typescript
import { createTestHarness, fakeSqsRecord } from '@nestfolio/event-processor';
import { createHandlers, type EventListenerDeps } from '../src/handlers/event-listener';

describe('advisory-ctrl event-listener', () => {
  const mockLifecycle = {
    processTriggerEvent: jest.fn().mockResolvedValue(undefined),
    processComplianceEvent: jest.fn().mockResolvedValue(undefined),
    processUserResponse: jest.fn().mockResolvedValue(undefined),
  };
  const mockRepo = {} as any;
  const deps: EventListenerDeps = { lifecycleService: mockLifecycle as any, repository: mockRepo };
  const harness = createTestHarness({ serviceName: 'advisory-ctrl', handlers: createHandlers(deps) });

  beforeEach(() => jest.clearAllMocks());

  it('routes trigger events to processTriggerEvent', async () => {
    await harness.process([
      fakeSqsRecord('MANDATE_GRANTED', { mandateId: 'm1' }, { tenantId: 't1' }),
    ]);
    expect(mockLifecycle.processTriggerEvent).toHaveBeenCalled();
  });

  it('routes DECISION_APPROVED to processComplianceEvent', async () => {
    await harness.process([
      fakeSqsRecord('DECISION_APPROVED', { decisionId: 'd1' }, { tenantId: 't1' }),
    ]);
    expect(mockLifecycle.processComplianceEvent).toHaveBeenCalled();
  });

  it('routes USER_CONFIRMED to processUserResponse', async () => {
    await harness.process([
      fakeSqsRecord('USER_CONFIRMED', {}, { tenantId: 't1' }),
    ]);
    expect(mockLifecycle.processUserResponse).toHaveBeenCalledWith(
      expect.anything(),
      'USER_CONFIRMED',
    );
  });
});
```

- [ ] **Step 3: Run tests → PASS, commit**

```bash
git add services/advisory/advisory-ctrl/src/handlers/event-listener.ts services/advisory/advisory-ctrl/test/event-listener.test.ts
git commit -m "feat(advisory-ctrl): migrate event-listener to event-processor"
```

---

### Task 12: compliance-ctrl event-listener (CRITICAL — no direct publishing)

**Key constraint:** Handler MUST only persist state via repository. Domain events (COMPLIANCE_CHECK_CREATED, AUDIT_ARTIFACT_CREATED) are published by the CDC event-publisher (Task 4) reading the DDB stream. NO `bus.publish()` in the handler. The `bus` parameter in `createEventHandler` config is ONLY for error events (handled by the engine automatically).

**Files:**
- Modify: `services/advisory/compliance-ctrl/src/handlers/event-listener.ts`
- Modify: `services/advisory/compliance-ctrl/test/event-listener.test.ts`

- [ ] **Step 1: Rewrite compliance-ctrl handler**

```typescript
// services/advisory/compliance-ctrl/src/handlers/event-listener.ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { createEventHandler, skip, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { logger, NotRetryableError } from '@nestfolio/platform-core';
import { requireEnv } from '@nestfolio/lambda-utils';
import { ComplianceRepository } from '../repositories/compliance.repository';
import { RuleEngine, type ComplianceInput, type MandateSnapshot } from '../rules/rule-engine';
import { MandateValidator } from '../rules/mandate-validator';
import { GuardrailEvaluator } from '../rules/guardrail-evaluator';
import { SuitabilityChecker } from '../rules/suitability-checker';
import { AuthorityResolver } from '../rules/authority-resolver';

export interface EventListenerDeps {
  readonly repository: ComplianceRepository;
  readonly ruleEngine: RuleEngine;
  // NOTE: No `bus` or `metrics` — engine handles both automatically
}

export const createHandlers = (deps: EventListenerDeps) => ({
  'DECISION_PACKET_CREATED': async (payload: EventPayload, ctx: EventContext) => {
    await processDecisionPacket(deps, payload, ctx);
    return skip();
  },
  'DECISION_PACKET_ENRICHED': async (payload: EventPayload, ctx: EventContext) => {
    await processDecisionPacket(deps, payload, ctx);
    return skip();
  },
  'MANDATE_GRANTED': async (payload: EventPayload, ctx: EventContext) => {
    await processMandateEvent(deps, payload, ctx, 'MANDATE_GRANTED');
    return skip();
  },
  'MANDATE_UPDATED': async (payload: EventPayload, ctx: EventContext) => {
    await processMandateEvent(deps, payload, ctx, 'MANDATE_UPDATED');
    return skip();
  },
  'MANDATE_REVOKED': async (payload: EventPayload, ctx: EventContext) => {
    await processMandateEvent(deps, payload, ctx, 'MANDATE_REVOKED');
    return skip();
  },
  'OPERATING_MODE_CHANGED': async (_payload: EventPayload, ctx: EventContext) => {
    logger.info('Operating mode changed, noted', { tenantId: ctx.tenantId });
    return skip();
  },
});

async function processDecisionPacket(
  deps: EventListenerDeps,
  payload: EventPayload,
  ctx: EventContext,
): Promise<void> {
  const subject = payload.subject;
  const requiredFields = ['proposedTrades', 'portfolioValue', 'riskScore', 'currentPositions'];
  const missingFields = requiredFields.filter((f) => !(f in subject));
  if (missingFields.length) {
    throw new NotRetryableError(`Missing fields: ${missingFields.join(', ')}`);
  }

  const tenantId = ctx.tenantId;
  const userId = (subject.userId as string) ?? tenantId;

  // READ — still uses repository
  const mandateRecord = await deps.repository.getMandateSnapshot(tenantId, userId);
  if (!mandateRecord) {
    logger.error('No mandate snapshot found for user', { tenantId, userId });
    const ccId = ctx.eventId;
    const created = await deps.repository.createComplianceCheck(tenantId, ccId, subject.decisionId as string, {
      mandateId: 'NONE', level: 'ADVISORY', monthlyTurnoverCapPercent: 0,
      maxSingleTradePercent: 0, effectiveDate: new Date().toISOString(), revokedAt: null,
    }, ctx.eventId);
    if (!created) {
      logger.info('Duplicate event, skipping', { eventId: ctx.eventId });
      return;
    }
    // PERSIST state — CDC publishes COMPLIANCE_CHECK_CREATED via DDB stream
    await deps.repository.updateCheckResult(tenantId, ccId, 'BLOCKED', [
      { rule: 'MANDATE_MISSING', description: 'No mandate found for user', severity: 'BLOCKING' },
    ], 'L2');
    return;
  }

  const mandate: MandateSnapshot = {
    mandateId: mandateRecord.mandateId as string,
    level: mandateRecord.level as 'ADVISORY' | 'DISCRETIONARY',
    monthlyTurnoverCapPercent: mandateRecord.monthlyTurnoverCapPercent as number,
    maxSingleTradePercent: mandateRecord.maxSingleTradePercent as number,
    effectiveDate: mandateRecord.effectiveDate as string,
    revokedAt: mandateRecord.revokedAt as string | null,
  };

  const ccId = ctx.eventId;
  const created = await deps.repository.createComplianceCheck(
    tenantId, ccId, subject.decisionId as string, mandate, ctx.eventId,
  );
  if (!created) {
    logger.info('Duplicate event, skipping', { eventId: ctx.eventId });
    return;
  }

  // COMPUTE — rule engine evaluation
  const complianceInput: ComplianceInput = {
    decisionPacketId: subject.decisionId as string,
    tenantId, userId, mandate,
    proposedTrades: (subject.proposedTrades as ComplianceInput['proposedTrades']) ?? [],
    portfolioValue: (subject.portfolioValue as number) ?? 0,
    riskScore: (subject.riskScore as number) ?? 5,
    currentPositions: (subject.currentPositions as ComplianceInput['currentPositions']) ?? [],
  };
  const output = deps.ruleEngine.evaluate(complianceInput);

  // PERSIST state — CDC publishes COMPLIANCE_CHECK_UPDATED via DDB stream
  await deps.repository.updateCheckResult(tenantId, ccId, output.result, output.violations, output.authorityLevel);

  // PERSIST audit artifact — CDC publishes AUDIT_ARTIFACT_CREATED via DDB stream
  const artifactId = ctx.eventId + '-audit';
  await deps.repository.createAuditArtifact(tenantId, ccId, artifactId, {
    decisionPacketId: subject.decisionId,
    input: complianceInput, output,
    evaluatedAt: new Date().toISOString(),
    sourceEventId: ctx.eventId,
  });

  logger.info('Compliance check completed', {
    ccId, decisionPacketId: subject.decisionId,
    result: output.result, authorityLevel: output.authorityLevel,
    violationCount: output.violations.length,
  });
}

async function processMandateEvent(
  deps: EventListenerDeps,
  payload: EventPayload,
  ctx: EventContext,
  eventType: string,
): Promise<void> {
  const subject = payload.subject;
  const tenantId = ctx.tenantId;
  const userId = (subject.userId as string) ?? tenantId;

  switch (eventType) {
    case 'MANDATE_GRANTED':
    case 'MANDATE_UPDATED':
      if (!subject.mandateId || !subject.level) {
        throw new NotRetryableError(
          `Missing required mandate fields: mandateId=${subject.mandateId}, level=${subject.level}`,
        );
      }
      // PERSIST state — no event publishing here
      await deps.repository.putMandateSnapshot(tenantId, userId, {
        mandateId: subject.mandateId,
        level: subject.level,
        monthlyTurnoverCapPercent: subject.monthlyTurnoverCapPercent,
        maxSingleTradePercent: subject.maxSingleTradePercent,
        effectiveDate: subject.effectiveDate,
        revokedAt: null,
      });
      logger.info('Mandate snapshot created/updated', { tenantId, userId, eventType });
      break;

    case 'MANDATE_REVOKED':
      await deps.repository.putMandateSnapshot(tenantId, userId, {
        mandateId: subject.mandateId,
        level: subject.level ?? 'ADVISORY',
        monthlyTurnoverCapPercent: subject.monthlyTurnoverCapPercent ?? 0,
        maxSingleTradePercent: subject.maxSingleTradePercent ?? 0,
        effectiveDate: subject.effectiveDate ?? new Date().toISOString(),
        revokedAt: subject.revokedAt ?? new Date().toISOString(),
      });
      logger.info('Mandate snapshot revoked', { tenantId, userId });
      break;
  }
}

// Production wiring
const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new ComplianceRepository(TABLE_NAME, dynamoClient);
const ruleEngine = new RuleEngine(
  new MandateValidator(), new GuardrailEvaluator(),
  new SuitabilityChecker(), new AuthorityResolver(),
);

const deps: EventListenerDeps = { repository, ruleEngine };

export const handler = createEventHandler({
  serviceName: 'compliance-ctrl',
  handlers: createHandlers(deps),
  table: TABLE_NAME,
  bus: requireEnv('BUS_NAME'),       // engine uses this ONLY for error events
  errorEventType: 'COMPLIANCE_CTRL_FAILED',
});
```

- [ ] **Step 2: Rewrite compliance-ctrl test**

```typescript
// services/advisory/compliance-ctrl/test/event-listener.test.ts
import { createTestHarness, fakeSqsRecord } from '@nestfolio/event-processor';
import { createHandlers, type EventListenerDeps } from '../src/handlers/event-listener';

describe('compliance-ctrl event-listener', () => {
  const mockRepository = {
    getMandateSnapshot: jest.fn(),
    createComplianceCheck: jest.fn().mockResolvedValue(true),
    updateCheckResult: jest.fn().mockResolvedValue({ ccId: 'cc1' }),
    createAuditArtifact: jest.fn().mockResolvedValue(true),
    putMandateSnapshot: jest.fn().mockResolvedValue(undefined),
  };

  const mockRuleEngine = {
    evaluate: jest.fn().mockReturnValue({
      result: 'APPROVED',
      violations: [],
      authorityLevel: 'L1',
    }),
  };

  const deps: EventListenerDeps = {
    repository: mockRepository as any,
    ruleEngine: mockRuleEngine as any,
  };

  const harness = createTestHarness({
    serviceName: 'compliance-ctrl',
    handlers: createHandlers(deps),
  });

  beforeEach(() => jest.clearAllMocks());

  describe('DECISION_PACKET_CREATED', () => {
    it('runs compliance check and persists result', async () => {
      mockRepository.getMandateSnapshot.mockResolvedValue({
        mandateId: 'm1', level: 'ADVISORY',
        monthlyTurnoverCapPercent: 25, maxSingleTradePercent: 10,
        effectiveDate: '2026-01-01', revokedAt: null,
      });

      const result = await harness.process([
        fakeSqsRecord('DECISION_PACKET_CREATED', {
          decisionId: 'd1', proposedTrades: [], portfolioValue: 100000,
          riskScore: 5, currentPositions: [],
        }, { tenantId: 't1', eventId: 'e1' }),
      ]);

      expect(result.skipped).toBe(1);
      expect(mockRepository.createComplianceCheck).toHaveBeenCalledWith(
        't1', 'e1', 'd1', expect.objectContaining({ mandateId: 'm1' }), 'e1',
      );
      expect(mockRuleEngine.evaluate).toHaveBeenCalled();
      expect(mockRepository.updateCheckResult).toHaveBeenCalledWith(
        't1', 'e1', 'APPROVED', [], 'L1',
      );
      expect(mockRepository.createAuditArtifact).toHaveBeenCalled();
    });

    it('skips duplicate events', async () => {
      mockRepository.getMandateSnapshot.mockResolvedValue({ mandateId: 'm1', level: 'ADVISORY', monthlyTurnoverCapPercent: 0, maxSingleTradePercent: 0, effectiveDate: '2026-01-01', revokedAt: null });
      mockRepository.createComplianceCheck.mockResolvedValue(false);

      const result = await harness.process([
        fakeSqsRecord('DECISION_PACKET_CREATED', {
          decisionId: 'd1', proposedTrades: [], portfolioValue: 100000,
          riskScore: 5, currentPositions: [],
        }, { tenantId: 't1', eventId: 'e1' }),
      ]);

      expect(result.skipped).toBe(1);
      expect(mockRuleEngine.evaluate).not.toHaveBeenCalled();
    });

    it('throws NotRetryableError for missing required fields', async () => {
      const result = await harness.process([
        fakeSqsRecord('DECISION_PACKET_CREATED', { decisionId: 'd1' }, { tenantId: 't1' }),
      ]);
      expect(result.errors).toHaveLength(1);
    });

    it('blocks when no mandate snapshot found', async () => {
      mockRepository.getMandateSnapshot.mockResolvedValue(null);

      await harness.process([
        fakeSqsRecord('DECISION_PACKET_CREATED', {
          decisionId: 'd1', proposedTrades: [], portfolioValue: 100000,
          riskScore: 5, currentPositions: [],
        }, { tenantId: 't1', eventId: 'e1' }),
      ]);

      expect(mockRepository.updateCheckResult).toHaveBeenCalledWith(
        't1', 'e1', 'BLOCKED',
        expect.arrayContaining([expect.objectContaining({ rule: 'MANDATE_MISSING' })]),
        'L2',
      );
    });
  });

  describe('MANDATE_GRANTED', () => {
    it('persists mandate snapshot', async () => {
      const result = await harness.process([
        fakeSqsRecord('MANDATE_GRANTED', {
          mandateId: 'm1', level: 'ADVISORY',
          monthlyTurnoverCapPercent: 25, maxSingleTradePercent: 10,
          effectiveDate: '2026-01-01',
        }, { tenantId: 't1' }),
      ]);

      expect(result.skipped).toBe(1);
      expect(mockRepository.putMandateSnapshot).toHaveBeenCalledWith(
        't1', 't1',
        expect.objectContaining({ mandateId: 'm1', level: 'ADVISORY', revokedAt: null }),
      );
    });

    it('throws for missing mandateId or level', async () => {
      const result = await harness.process([
        fakeSqsRecord('MANDATE_GRANTED', {}, { tenantId: 't1' }),
      ]);
      expect(result.errors).toHaveLength(1);
    });
  });

  describe('MANDATE_REVOKED', () => {
    it('persists revoked mandate snapshot', async () => {
      await harness.process([
        fakeSqsRecord('MANDATE_REVOKED', {
          mandateId: 'm1', revokedAt: '2026-03-16',
        }, { tenantId: 't1' }),
      ]);

      expect(mockRepository.putMandateSnapshot).toHaveBeenCalledWith(
        't1', 't1',
        expect.objectContaining({ revokedAt: '2026-03-16' }),
      );
    });
  });

  describe('OPERATING_MODE_CHANGED', () => {
    it('logs and skips', async () => {
      const result = await harness.process([
        fakeSqsRecord('OPERATING_MODE_CHANGED', { mode: 'PAUSED' }, { tenantId: 't1' }),
      ]);
      expect(result.skipped).toBe(1);
      expect(mockRepository.putMandateSnapshot).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 3: Run tests → PASS**

Run: `npx nx test compliance-ctrl -- --testPathPattern='event-listener'`
Expected: PASS

- [ ] **Step 4: Verify NO direct event publishing in handler**

Grep the handler file to confirm no `bus.publish`, `EventBridgeBus`, or `publishErrorEvent` calls:
```bash
grep -E 'bus\.(publish|send)|EventBridgeBus|publishErrorEvent' services/advisory/compliance-ctrl/src/handlers/event-listener.ts
```
Expected: No matches

- [ ] **Step 5: Commit**

```bash
git add services/advisory/compliance-ctrl/src/handlers/event-listener.ts services/advisory/compliance-ctrl/test/event-listener.test.ts
git commit -m "feat(compliance-ctrl): migrate event-listener to event-processor — state-only, no direct publishing"
```

---

### Task 13: ledger-ctrl event-listener (dual-path: actual + simulation)

ledger-ctrl has two processing paths: actual ledger events and simulation events. Both delegate to service methods.

**Files:**
- Modify: `services/ledger/ledger-ctrl/src/handlers/event-listener.ts`
- Modify: `services/ledger/ledger-ctrl/test/event-listener.test.ts`

- [ ] **Step 1: Rewrite ledger-ctrl handler**

```typescript
// services/ledger/ledger-ctrl/src/handlers/event-listener.ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { createEventHandler, skip, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { getTime, logger } from '@nestfolio/platform-core';
import { requireEnv } from '@nestfolio/lambda-utils';
import { LedgerRepository } from '../repositories/ledger.repository';
import { ShadowFillService, type ProposedTrade } from '../services/shadow-fill.service';

export interface EventListenerDeps {
  readonly repository: LedgerRepository;
  readonly shadowFill: ShadowFillService;
}

const ACTUAL_EVENT_TYPES = [
  'ORDER_FILLED', 'ORDER_PARTIALLY_FILLED', 'ORDER_REJECTED', 'ORDER_CANCELLED',
  'DEPOSIT_DETECTED', 'WITHDRAWAL_COMPLETED', 'CORPORATE_ACTION_PROCESSED',
] as const;

export const createHandlers = (deps: EventListenerDeps) => {
  const handlers: Record<string, (payload: EventPayload, ctx: EventContext) => Promise<ReturnType<typeof skip>>> = {};

  // Actual ledger events
  for (const type of ACTUAL_EVENT_TYPES) {
    handlers[type] = async (payload, ctx) => {
      const tenantId = ctx.tenantId;
      const subject = payload.subject ?? {};
      const context = payload.context ?? {};
      const eventPayload = { ...subject, userId: (subject as any).userId ?? (context as any).userId };
      const sequenceNo = await deps.repository.nextSequence(tenantId, 'actual');
      const created = await deps.repository.putLedgerEntry({
        tenantId, streamType: 'actual', eventId: ctx.eventId, eventType: ctx.eventType,
        payload: eventPayload, timestamp: ctx.timestamp, sequenceNo,
        decisionId: (subject as any).decisionId,
      });
      if (!created) {
        logger.info('Duplicate ledger entry, skipping', { eventType: ctx.eventType, eventId: ctx.eventId });
      }
      return skip();
    };
  }

  // Simulation event
  handlers['DECISION_PACKET_CREATED'] = async (payload, ctx) => {
    const tenantId = ctx.tenantId;
    const subject = payload.subject ?? {};
    const decisionPacketId = (subject as any).decisionPacketId ?? ctx.eventId;
    const proposedTrades = ((subject as any).proposedTrades ?? []) as ProposedTrade[];

    if (proposedTrades.length === 0) {
      logger.info('No proposed trades in decision packet, skipping', { decisionPacketId });
      return skip();
    }

    const now = getTime();

    for (const trade of proposedTrades) {
      const fillResult = await deps.shadowFill.simulateFill(trade);
      const sequenceNo = await deps.repository.nextSequence(tenantId, 'simulated');
      const created = await deps.repository.putLedgerEntry({
        tenantId, streamType: 'simulated',
        eventId: `${ctx.eventId}-sim-${trade.symbol}`,
        eventType: 'ORDER_FILLED',
        payload: {
          orderId: `sim-${decisionPacketId}-${trade.symbol}`,
          symbol: trade.symbol, side: trade.side, quantity: trade.quantity,
          fillPrice: fillResult.price, filledAt: now,
        },
        timestamp: now, sequenceNo, decisionId: decisionPacketId,
      });
      if (!created) {
        logger.info('Duplicate simulation entry, skipping', { symbol: trade.symbol, eventId: ctx.eventId });
      }
    }
    return skip();
  };

  return handlers;
};

// Production wiring
const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new LedgerRepository(TABLE_NAME, dynamoClient);
const deps: EventListenerDeps = { repository, shadowFill: new ShadowFillService() };

export const handler = createEventHandler({
  serviceName: 'ledger-ctrl',
  handlers: createHandlers(deps),
  table: TABLE_NAME,
  bus: requireEnv('BUS_NAME'),
  errorEventType: 'LEDGER_CTRL_FAILED',
});
```

- [ ] **Step 2: Rewrite ledger-ctrl test**

```typescript
// services/ledger/ledger-ctrl/test/event-listener.test.ts
import { createTestHarness, fakeSqsRecord } from '@nestfolio/event-processor';
import { createHandlers, type EventListenerDeps } from '../src/handlers/event-listener';

describe('ledger-ctrl event-listener', () => {
  const mockRepo = {
    nextSequence: jest.fn().mockResolvedValue(1),
    putLedgerEntry: jest.fn().mockResolvedValue(true),
  };
  const mockShadowFill = {
    simulateFill: jest.fn().mockResolvedValue({ price: 150.0 }),
  };
  const deps: EventListenerDeps = { repository: mockRepo as any, shadowFill: mockShadowFill as any };
  const harness = createTestHarness({ serviceName: 'ledger-ctrl', handlers: createHandlers(deps) });

  beforeEach(() => jest.clearAllMocks());

  describe('actual events', () => {
    it('creates a ledger entry for ORDER_FILLED', async () => {
      const result = await harness.process([
        fakeSqsRecord('ORDER_FILLED', { orderId: 'o1', symbol: 'AAPL', side: 'BUY' }, { tenantId: 't1', eventId: 'e1' }),
      ]);
      expect(result.skipped).toBe(1);
      expect(mockRepo.putLedgerEntry).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 't1', streamType: 'actual', eventId: 'e1', eventType: 'ORDER_FILLED' }),
      );
    });

    it('skips duplicate ledger entries', async () => {
      mockRepo.putLedgerEntry.mockResolvedValue(false);
      const result = await harness.process([
        fakeSqsRecord('ORDER_FILLED', { orderId: 'o1' }, { tenantId: 't1', eventId: 'e1' }),
      ]);
      expect(result.skipped).toBe(1);
    });
  });

  describe('simulation events', () => {
    it('shadow-fills proposed trades for DECISION_PACKET_CREATED', async () => {
      await harness.process([
        fakeSqsRecord('DECISION_PACKET_CREATED', {
          decisionPacketId: 'dp1',
          proposedTrades: [
            { symbol: 'AAPL', side: 'BUY', quantity: 10 },
            { symbol: 'GOOGL', side: 'SELL', quantity: 5 },
          ],
        }, { tenantId: 't1', eventId: 'e1' }),
      ]);
      expect(mockShadowFill.simulateFill).toHaveBeenCalledTimes(2);
      expect(mockRepo.putLedgerEntry).toHaveBeenCalledTimes(2);
      expect(mockRepo.putLedgerEntry).toHaveBeenCalledWith(
        expect.objectContaining({ streamType: 'simulated', eventType: 'ORDER_FILLED' }),
      );
    });

    it('skips when no proposed trades', async () => {
      await harness.process([
        fakeSqsRecord('DECISION_PACKET_CREATED', { proposedTrades: [] }, { tenantId: 't1' }),
      ]);
      expect(mockShadowFill.simulateFill).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 3: Run tests → PASS, commit**

```bash
git add services/ledger/ledger-ctrl/
git commit -m "feat(ledger-ctrl): migrate event-listener to event-processor"
```

---

### Task 14: Remove deprecated lambda-utils code

After all services are migrated, clean up lambda-utils.

**Safe to remove** (only used by old event-listener pattern + now handled by event-processor engine):
- `libs/lambda-utils/src/event-publisher.ts` + `EVENT_PUBLISHER_ENTRY` — replaced by per-service CDC handlers
- `publishErrorEvent` — engine handles error publishing automatically

**MUST KEEP** (used outside event-listeners):
- `parseRecord` — used by `event-processor/src/engine/batch-engine.ts`
- `createServiceMetrics`, `MetricUnit` — used by `ledger-ctrl/src/handlers/reducer.ts`
- `EventBridgeBus` — used by `ledger-bff/src/handlers/graphql-resolver.ts`
- `applyMiddleware`, `withLambdaContext`, `withTiming` — used by event-processor engine, reducer.ts, graphql-resolver.ts
- `traceEvent` — used by `event-processor/src/engine/batch-engine.ts`
- `isRetryable` — used by event-processor engine
- `requireEnv`, `extractTenantId`, `NotRetryableError`, `withMethodLogging` — widely used

**Files:**
- Modify: `libs/lambda-utils/src/index.ts` (remove `EVENT_PUBLISHER_ENTRY` export)
- Delete: `libs/lambda-utils/src/event-publisher.ts`
- Delete: `libs/lambda-utils/test/event-publisher.test.ts`

- [ ] **Step 1: Verify EVENT_PUBLISHER_ENTRY is only referenced as Egress fallback**

```bash
grep -rn "EVENT_PUBLISHER_ENTRY" --include="*.ts" libs/ services/ | grep -v node_modules | grep -v '.test.'
```

Expected: Only `libs/lambda-utils/src/index.ts` and `libs/cdk-constructs/src/egress.ts` (fallback).

- [ ] **Step 2: Remove the shared event-publisher handler**

Delete `libs/lambda-utils/src/event-publisher.ts` and its test `libs/lambda-utils/test/event-publisher.test.ts`.

Remove `EVENT_PUBLISHER_ENTRY` export and the `join` import from `libs/lambda-utils/src/index.ts` (only if `join` is not used by other exports).

- [ ] **Step 3: Run all tests**

Run: `npx nx run-many --target=test --all`
Expected: ALL projects pass

- [ ] **Step 4: Commit**

```bash
git add libs/lambda-utils/
git commit -m "chore(lambda-utils): remove deprecated event-publisher handler and EVENT_PUBLISHER_ENTRY"
```

---

### Task 15: Full verification

- [ ] **Step 1: Run all tests across all projects**

Run: `npx nx run-many --target=test --all`
Expected: ALL projects pass (31 projects)

- [ ] **Step 2: Verify no remaining old-pattern imports in migrated handlers**

```bash
grep -r "parseRecord\|createServiceMetrics\|applyMiddleware\|withLambdaContext\|withTiming\|publishErrorEvent" --include="event-listener.ts" services/
```
Expected: No matches (all boilerplate removed)

- [ ] **Step 3: Verify compliance-ctrl has no direct publishing**

```bash
grep -E "bus\.(publish|send)|EventBridgeBus|publishErrorEvent" services/advisory/compliance-ctrl/src/handlers/event-listener.ts
```
Expected: No matches (the `bus: requireEnv('BUS_NAME')` in createEventHandler config is fine — it's only for engine-managed error events)

- [ ] **Step 4: Verify all Egress constructs use handlerEntry**

```bash
grep -r "handlerEntry" --include="*.stack.ts" services/
```
Expected: 9 matches (one per service with Egress)

- [ ] **Step 5: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "chore: event-processor migration verification and fixes"
```
