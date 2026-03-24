# RequestContext Pattern Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce `RequestContext` (tenantId, userId, region) as a typed context object that propagates from BFF handlers through DynamoDB rows, CDC events, and downstream consumers.

**Architecture:** `RequestContext` replaces `TenantContext` as the second generic on `BusEvent<T, S>` and `TableEntry<T, S>`. Initialized at BFF boundary via `authorizeRequest`, flattened into DDB rows, extracted by CDC into events, validated by Zod at ingestion. Branded types (`TenantId`, `UserId`) enforce compile-time safety.

**Tech Stack:** TypeScript, Zod, AWS EventBridge, DynamoDB Streams, AppSync JS resolvers

**Spec:** `docs/superpowers/specs/2026-03-24-request-context-design.md`

---

## File Structure

### Core types (libs/event-processor)
| File | Responsibility |
|------|---------------|
| `src/domain/schemas.ts` | `RequestContext`, `RequestContextSchema`, `parseRequestContext`, `BusEventPayload` |
| `src/platform/bus.ts` | `BusEvent<T, S = RequestContext>` |
| `src/platform/table.ts` | `TableEntry<T, S = RequestContext>` |
| `src/platform/errors.ts` | `ErrorEvent` with `context: RequestContext` |

### Internal utilities (libs/event-processor)
| File | Responsibility |
|------|---------------|
| `src/internal/extract-request-context.ts` | `extractRequestContext` (replaces `extract-tenant-id.ts`) |
| `src/internal/trace-event.ts` | Add `UserId` X-Ray annotation |

### Stream & ingestion (libs/event-processor)
| File | Responsibility |
|------|---------------|
| `src/types/stream-types.ts` | `StreamRecord`, `StreamContext` with `userId`, `region` |
| `src/types/event-context.ts` | `EventContext` with required `userId`, add `region` |
| `src/util/unmarshal-stream.ts` | Extract `userId`, `region` from DDB image |
| `src/util/to-uow.ts` | Build full `RequestContext` in fallback |
| `src/engine/parse-sqs-record.ts` | Validate `userId`, `region` on incoming events |
| `src/engine/parse-kinesis-record.ts` | Validate `userId`, `region` on incoming events |
| `src/engine/ingestion-engine.ts` | Use `extractRequestContext`, pass `region` to `EventContext` |
| `src/pipelines/change-data-capture.ts` | Full context extraction from stream record |

### Error publishing (libs/event-processor)
| File | Responsibility |
|------|---------------|
| `src/engine/error-event-publisher.ts` | Accept `RequestContext` for error events |
| `src/lambda/publish-error-event.ts` | Include `RequestContext` in `ErrorEvent` |
| `src/lambda/middleware/with-error-publishing.ts` | Thread context to error publisher |

### Authorization (libs/event-processor)
| File | Responsibility |
|------|---------------|
| `src/lambda/authorize-request.ts` | `authorizeRequest(event, region)` → `RequestContext` |
| `src/lambda/authorize-tenant.ts` | DELETE |

### Test utilities (libs/event-processor)
| File | Responsibility |
|------|---------------|
| `src/lambda/test-utils/evaluate-resolver.ts` | Fix `createAuthContext` claim key |

### Barrel exports (libs/event-processor)
| File | Responsibility |
|------|---------------|
| `src/domain/index.ts` | Export `RequestContext`, `RequestContextSchema`, `parseRequestContext`, `BusEventPayload` |
| `src/internal/index.ts` | Export `extractRequestContext` (remove `extractTenantId`) |
| `src/lambda/index.ts` | Export `authorizeRequest` (remove `authorizeTenant`, `authorizeUser`) |
| `src/platform/index.ts` | No changes (already re-exports `TableEntry`, `BusEvent`, `ErrorEvent`) |
| `src/index.ts` | Update all public API exports |

### Service migrations
| File | Responsibility |
|------|---------------|
| `services/ledger/ledger-bff/src/handlers/graphql-resolver.ts` | `authorizeRequest`, add `REGION` (only Lambda-based BFF resolver) |
| `services/ledger/ledger-bff/test/handlers/graphql-resolver.test.ts` | Update mock from `authorizeTenant` → `authorizeRequest` |
| `services/*/check-auth.fn.js` (4 files) | Extract `userId` from `sub` claim, stash `region` |
| `services/ledger/ledger-bff/src/transforms/*.ts` (3 files) | Typed context access |
| `services/investor/dashboard-bff/src/transforms/*.ts` (6 files) | Typed context access |
| `services/investor/onboarding-bff/src/handlers/event-publisher.ts` | Audit for context propagation |

**Note:** Only `ledger-bff` has a Lambda-based `graphql-resolver.ts`. `investor-bff`, `dashboard-bff`, and `advisory-bff` use only JS pipeline resolvers (no Lambda resolver handler).

**Note:** `libs/shell` has its own `TenantContext` interface (frontend Angular type) — unrelated to backend `TenantContext`, no changes needed.

---

## Task 1: Core Types — RequestContext, BusEvent, TableEntry

**Files:**
- Modify: `libs/event-processor/src/domain/schemas.ts`
- Modify: `libs/event-processor/src/platform/bus.ts`
- Modify: `libs/event-processor/src/platform/table.ts`
- Test: `libs/event-processor/test/domain/schemas.test.ts`

- [ ] **Step 1: Write failing tests for RequestContextSchema and parseRequestContext**

In `libs/event-processor/test/domain/schemas.test.ts`, replace the `TenantContextSchema` describe block and update the `BusEventSchema` tests:

```typescript
import {
  BusEventSchema,
  RequestContextSchema,
  parseRequestContext,
} from '../../src/domain/schemas';
import { randomUUID } from 'crypto';

// ... keep existing BusEventSchema describe block but update validEvent:
// context: { tenantId: randomUUID(), userId: randomUUID(), region: 'us-east-1' }

describe('RequestContextSchema', () => {
  it('should parse a valid request context', () => {
    const result = RequestContextSchema.safeParse({
      tenantId: randomUUID(),
      userId: randomUUID(),
      region: 'us-east-1',
    });
    expect(result.success).toBe(true);
  });

  it('should reject missing tenantId', () => {
    const result = RequestContextSchema.safeParse({
      userId: randomUUID(),
      region: 'us-east-1',
    });
    expect(result.success).toBe(false);
  });

  it('should reject missing userId', () => {
    const result = RequestContextSchema.safeParse({
      tenantId: randomUUID(),
      region: 'us-east-1',
    });
    expect(result.success).toBe(false);
  });

  it('should reject missing region', () => {
    const result = RequestContextSchema.safeParse({
      tenantId: randomUUID(),
      userId: randomUUID(),
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid tenantId uuid', () => {
    const result = RequestContextSchema.safeParse({
      tenantId: 'bad',
      userId: randomUUID(),
      region: 'us-east-1',
    });
    expect(result.success).toBe(false);
  });
});

describe('parseRequestContext', () => {
  it('should return branded RequestContext from valid input', () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    const ctx = parseRequestContext({
      tenantId,
      userId,
      region: 'us-east-1',
    });
    expect(ctx.tenantId).toBe(tenantId);
    expect(ctx.userId).toBe(userId);
    expect(ctx.region).toBe('us-east-1');
  });

  it('should throw on invalid input', () => {
    expect(() => parseRequestContext({ tenantId: 'bad' })).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx test event-processor --testPathPattern=schemas`
Expected: FAIL — `RequestContextSchema` and `parseRequestContext` not exported

- [ ] **Step 3: Implement RequestContext in schemas.ts**

Replace `libs/event-processor/src/domain/schemas.ts` with:

```typescript
import { z } from 'zod';
import { type TenantId, type UserId, asTenantId, asUserId } from '../platform/types/branded';

export const RequestContextSchema = z.object({
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
  region: z.string(),
});

export type RequestContext = {
  tenantId: TenantId;
  userId: UserId;
  region: string;
};

/**
 * Parses and validates raw input against RequestContextSchema,
 * then returns branded RequestContext.
 */
export function parseRequestContext(raw: unknown): RequestContext {
  const parsed = RequestContextSchema.parse(raw);
  return {
    tenantId: asTenantId(parsed.tenantId),
    userId: asUserId(parsed.userId),
    region: parsed.region,
  };
}

export const BusEventSchema = z.object({
  id: z.string().uuid(),
  type: z.string().min(1),
  timestamp: z.string().datetime(),
  subject: z.record(z.unknown()),
  context: RequestContextSchema,
});

export type BusEventPayload = z.infer<typeof BusEventSchema>;
```

- [ ] **Step 4: Update BusEvent default generic**

In `libs/event-processor/src/platform/bus.ts`, change line 5:

```typescript
import type { RequestContext } from '../domain/schemas';

export type BusEvent<T = object, S = RequestContext> = Event & {
  subject: T;
  context: S;
};
```

- [ ] **Step 5: Make TableEntry generic**

Replace `libs/event-processor/src/platform/table.ts` with:

```typescript
import type { RequestContext } from '../domain/schemas';

export type TableEntry<T = Record<string, unknown>, S = RequestContext> = T & {
  pk: string;
  sk: string;
  __typename: string;
  timestamp: string;
  ttl?: number;
} & S;
```

- [ ] **Step 6: Update ErrorEvent to carry RequestContext**

In `libs/event-processor/src/platform/errors.ts`, update `ErrorEvent` (around line 21):

```typescript
import type { RequestContext } from '../domain/schemas';

export type ErrorEvent = {
  id: string;
  type: string;
  timestamp: string;
  context?: RequestContext;
  error: {
    name: string;
    message: string;
    details?: Record<string, unknown>;
  };
};
```

Note: `context` is optional because error events may be published before context is available (e.g., parse failures).

- [ ] **Step 7: Update domain barrel exports**

Replace `libs/event-processor/src/domain/index.ts` with:

```typescript
export {
  DomainError,
  DomainValidationError,
  EntityNotFoundError,
  BusinessRuleViolationError,
  TenantAccessDeniedError,
} from './errors';

export {
  BusEventSchema,
  RequestContextSchema,
  parseRequestContext,
} from './schemas';

export type {
  BusEventPayload,
  RequestContext,
} from './schemas';
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm nx test event-processor --testPathPattern=schemas`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add libs/event-processor/src/domain/ libs/event-processor/src/platform/bus.ts libs/event-processor/src/platform/table.ts libs/event-processor/src/platform/errors.ts libs/event-processor/test/domain/schemas.test.ts
git commit -m "feat(event-processor): add RequestContext type, make BusEvent and TableEntry generic"
```

---

## Task 2: Internal Utilities — extractRequestContext, traceEvent

**Files:**
- Create: `libs/event-processor/src/internal/extract-request-context.ts`
- Delete: `libs/event-processor/src/internal/extract-tenant-id.ts`
- Modify: `libs/event-processor/src/internal/trace-event.ts`
- Modify: `libs/event-processor/src/internal/index.ts`

- [ ] **Step 1: Write failing test for extractRequestContext**

Create test in `libs/event-processor/test/internal/extract-request-context.test.ts`:

```typescript
import { extractRequestContext } from '../../src/internal/extract-request-context';
import { randomUUID } from 'crypto';

describe('extractRequestContext', () => {
  const tenantId = randomUUID();
  const userId = randomUUID();
  const region = 'us-east-1';

  it('should extract full RequestContext from event.context', () => {
    const ctx = extractRequestContext({
      context: { tenantId, userId, region },
      subject: {},
    });
    expect(ctx.tenantId).toBe(tenantId);
    expect(ctx.userId).toBe(userId);
    expect(ctx.region).toBe(region);
  });

  it('should throw NotRetryableError when tenantId is missing', () => {
    expect(() =>
      extractRequestContext({ context: { userId, region }, subject: {} }),
    ).toThrow('Missing tenantId');
  });

  it('should throw NotRetryableError when userId is missing', () => {
    expect(() =>
      extractRequestContext({ context: { tenantId, region }, subject: {} }),
    ).toThrow('Missing userId');
  });

  it('should throw NotRetryableError when region is missing', () => {
    expect(() =>
      extractRequestContext({ context: { tenantId, userId }, subject: {} }),
    ).toThrow('Missing region');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test event-processor --testPathPattern=extract-request-context`
Expected: FAIL — module not found

- [ ] **Step 3: Implement extractRequestContext**

Create `libs/event-processor/src/internal/extract-request-context.ts`:

```typescript
import { NotRetryableError } from './errors';
import type { RequestContext } from '../domain/schemas';
import { asTenantId, asUserId } from '../platform/types/branded';

/**
 * Extracts RequestContext from a domain event's context field.
 * Throws NotRetryableError if any required field is missing.
 */
export function extractRequestContext(event: Record<string, unknown>): RequestContext {
  const context = event.context as Record<string, unknown> | undefined;

  const tenantId = context?.tenantId;
  const userId = context?.userId;
  const region = context?.region;

  if (!tenantId || typeof tenantId !== 'string') {
    throw new NotRetryableError('Missing tenantId in event context');
  }
  if (!userId || typeof userId !== 'string') {
    throw new NotRetryableError('Missing userId in event context');
  }
  if (!region || typeof region !== 'string') {
    throw new NotRetryableError('Missing region in event context');
  }

  return {
    tenantId: asTenantId(tenantId),
    userId: asUserId(userId),
    region,
  };
}
```

- [ ] **Step 4: Delete extract-tenant-id.ts**

```bash
rm libs/event-processor/src/internal/extract-tenant-id.ts
```

- [ ] **Step 5: Update traceEvent to add UserId annotation**

In `libs/event-processor/src/internal/trace-event.ts`:

```typescript
import { tracer } from './tracer';

/**
 * Adds X-Ray annotations for the current event being processed.
 * Call this in event handlers to enable filtering traces by event type, tenant, and user.
 */
export function traceEvent(eventType: string, eventId: string, tenantId?: string, userId?: string): void {
  try {
    tracer.putAnnotation('EventType', eventType);
    tracer.putAnnotation('EventId', eventId);
    if (tenantId) {
      tracer.putAnnotation('TenantId', tenantId);
    }
    if (userId) {
      tracer.putAnnotation('UserId', userId);
    }
  } catch {
    // Silently ignore tracing errors (e.g., when running locally without X-Ray daemon)
  }
}
```

- [ ] **Step 6: Update internal barrel exports**

In `libs/event-processor/src/internal/index.ts`, replace `extractTenantId` with `extractRequestContext`:

```typescript
export { NotRetryableError, isRetryable } from './errors';
export { getUUID, getTime } from './core';
export { logger } from './logger';
export { tracer } from './tracer';
export { traceEvent } from './trace-event';
export { extractRequestContext } from './extract-request-context';
export { guardedWrite } from './guarded-write';
export { applyMiddleware, withLambdaContext, withTiming } from './middleware';
export type { Middleware, LambdaHandler } from './middleware';
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm nx test event-processor --testPathPattern=extract-request-context`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add libs/event-processor/src/internal/ libs/event-processor/test/internal/
git commit -m "feat(event-processor): add extractRequestContext, update traceEvent with UserId"
```

---

## Task 3: Stream Types & unmarshalStream

**Files:**
- Modify: `libs/event-processor/src/types/stream-types.ts`
- Modify: `libs/event-processor/src/util/unmarshal-stream.ts`

- [ ] **Step 1: Add userId and region to StreamRecord and StreamContext**

In `libs/event-processor/src/types/stream-types.ts`:

```typescript
import type { DynamoDBRecord } from 'aws-lambda';

export interface StreamRecord {
  readonly pk: string;
  readonly sk: string;
  readonly __typename: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly region: string;
  readonly eventName: 'INSERT' | 'MODIFY' | 'REMOVE';
  readonly sequenceNo?: number;
  readonly [key: string]: unknown;
}

export interface StreamContext {
  readonly serviceName: string;
  readonly record: DynamoDBRecord;
  readonly eventName: 'INSERT' | 'MODIFY' | 'REMOVE';
  readonly keys: { pk: string; sk: string };
  readonly typename: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly region: string;
  readonly newImage?: Record<string, unknown>;
  readonly oldImage?: Record<string, unknown>;
}
```

- [ ] **Step 2: Update unmarshalStream to extract userId and region**

In `libs/event-processor/src/util/unmarshal-stream.ts`, update the return statement to include `userId` and `region`:

```typescript
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
      userId: unmarshalled.userId as string,
      region: unmarshalled.region as string,
      eventName,
      ...unmarshalled,
    } as StreamRecord,
    ctx: {
      serviceName,
      record,
      eventName,
      keys: { pk: unmarshalled.pk as string, sk: unmarshalled.sk as string },
      typename: unmarshalled.__typename as string,
      tenantId: unmarshalled.tenantId as string,
      userId: unmarshalled.userId as string,
      region: unmarshalled.region as string,
      newImage: eventName !== 'REMOVE' ? unmarshalled : undefined,
      oldImage,
    },
  };
}
```

- [ ] **Step 3: Run existing stream tests**

Run: `pnpm nx test event-processor --testPathPattern="unmarshal|stream|egestion"`
Expected: PASS (existing tests should still work since `StreamRecord` has index signature)

- [ ] **Step 4: Commit**

```bash
git add libs/event-processor/src/types/stream-types.ts libs/event-processor/src/util/unmarshal-stream.ts
git commit -m "feat(event-processor): add userId and region to stream types and unmarshalStream"
```

---

## Task 4: Ingestion Pipeline — EventContext, toUow, parsers, engine

**Files:**
- Modify: `libs/event-processor/src/types/event-context.ts`
- Modify: `libs/event-processor/src/util/to-uow.ts`
- Modify: `libs/event-processor/src/engine/parse-sqs-record.ts`
- Modify: `libs/event-processor/src/engine/parse-kinesis-record.ts`
- Modify: `libs/event-processor/src/engine/ingestion-engine.ts`

- [ ] **Step 1: Update EventContext — add region, make userId required**

In `libs/event-processor/src/types/event-context.ts`:

```typescript
export interface EventContext {
  readonly eventId: string;
  readonly eventType: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly region: string;
  readonly timestamp: string;
  readonly receiveCount?: number;
  readonly serviceName: string;
  readonly record: unknown;
}
```

- [ ] **Step 2: Update toUow to build full context fallback**

In `libs/event-processor/src/util/to-uow.ts`:

```typescript
import type { EventPayload } from '../types/handler-config';
import type { EventContext } from '../types/event-context';
import type { UnitOfWork, BusEvent } from '../platform';

export function toUow(payload: EventPayload, ctx: EventContext): UnitOfWork<BusEvent<Record<string, unknown>>> {
  const event: BusEvent<Record<string, unknown>> = {
    id: ctx.eventId,
    type: ctx.eventType,
    timestamp: ctx.timestamp,
    subject: payload.subject as Record<string, unknown>,
    context: payload.context ?? {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      region: ctx.region,
    },
  };
  return { event, payload: payload.subject as Record<string, unknown>, record: {} };
}
```

- [ ] **Step 3: Update parseSqsRecord to validate userId and region**

In `libs/event-processor/src/engine/parse-sqs-record.ts`, add validation after the tenantId check (after line 37):

```typescript
  if (!(event.context as Record<string, unknown>)?.userId) {
    throw new NotRetryableError(
      'Invalid event: missing "context.userId" field',
      { messageId: sqsRecord.messageId },
    );
  }

  if (!(event.context as Record<string, unknown>)?.region) {
    throw new NotRetryableError(
      'Invalid event: missing "context.region" field',
      { messageId: sqsRecord.messageId },
    );
  }
```

- [ ] **Step 4: Update parseKinesisRecord to validate userId and region**

In `libs/event-processor/src/engine/parse-kinesis-record.ts`, add the same validation after the tenantId check (after line 38):

```typescript
  if (!(event.context as Record<string, unknown>)?.userId) {
    throw new NotRetryableError(
      'Invalid event: missing "context.userId" field',
      { sequenceNumber: kinesisRecord.kinesis.sequenceNumber },
    );
  }

  if (!(event.context as Record<string, unknown>)?.region) {
    throw new NotRetryableError(
      'Invalid event: missing "context.region" field',
      { sequenceNumber: kinesisRecord.kinesis.sequenceNumber },
    );
  }
```

- [ ] **Step 5: Update IngestionEngine to use extractRequestContext**

In `libs/event-processor/src/engine/ingestion-engine.ts`:

Change import (line 1):
```typescript
import { isRetryable, traceEvent, extractRequestContext } from '../internal';
```

Update the process method (around lines 65-85):
```typescript
          const reqCtx = extractRequestContext(event);
          traceEvent(eventType, event.id, reqCtx.tenantId, reqCtx.userId);

          // ... handler routing unchanged ...

          // Build context
          const ctx: EventContext = {
            eventId: event.id,
            eventType,
            tenantId: reqCtx.tenantId,
            userId: reqCtx.userId,
            region: reqCtx.region,
            timestamp: event.timestamp,
            receiveCount: metadata.receiveCount,
            serviceName: this.config.serviceName,
            record: ingestionRecord,
          };
```

- [ ] **Step 6: Run ingestion engine tests**

Run: `pnpm nx test event-processor --testPathPattern="ingestion|parse-sqs|parse-kinesis|to-uow"`
Expected: Some tests may fail due to missing `userId`/`region` in test fixtures — note which ones need updating (will be fixed in Task 8)

- [ ] **Step 7: Commit**

```bash
git add libs/event-processor/src/types/event-context.ts libs/event-processor/src/util/to-uow.ts libs/event-processor/src/engine/parse-sqs-record.ts libs/event-processor/src/engine/parse-kinesis-record.ts libs/event-processor/src/engine/ingestion-engine.ts
git commit -m "feat(event-processor): propagate full RequestContext through ingestion pipeline"
```

---

## Task 5: CDC Pipeline — changeDataCapture

**Files:**
- Modify: `libs/event-processor/src/pipelines/change-data-capture.ts`

- [ ] **Step 1: Update buildEntry to extract full context from stream record**

In `libs/event-processor/src/pipelines/change-data-capture.ts`, update the `buildEntry` function (around line 39-45):

```typescript
  const detail = {
    id: ctx.record.eventID ?? getUUID(),
    type: eventType,
    timestamp: new Date().toISOString(),
    subject: transform ? transform(record, eventType) : record,
    context: {
      tenantId: record.tenantId,
      userId: record.userId,
      region: record.region,
    },
  };
```

- [ ] **Step 2: Run CDC tests**

Run: `pnpm nx test event-processor --testPathPattern="change-data-capture|cdc"`
Expected: PASS (or note failures for fixture updates in Task 8)

- [ ] **Step 3: Commit**

```bash
git add libs/event-processor/src/pipelines/change-data-capture.ts
git commit -m "feat(event-processor): extract full RequestContext in changeDataCapture"
```

---

## Task 6: Error Event Publishing Chain

**Files:**
- Modify: `libs/event-processor/src/engine/error-event-publisher.ts`
- Modify: `libs/event-processor/src/lambda/publish-error-event.ts`
- Modify: `libs/event-processor/src/lambda/middleware/with-error-publishing.ts`

- [ ] **Step 1: Update ErrorEventPublisher to accept RequestContext**

In `libs/event-processor/src/engine/error-event-publisher.ts`, update `publishErrors` to accept optional `RequestContext`:

```typescript
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { logger, getUUID, getTime } from '../internal';
import type { RequestContext } from '../domain/schemas';

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
    errors: Array<{ error: Error; causedBy: unknown; groupKey?: string; context?: RequestContext }>,
    errorEventType: string,
  ): Promise<void> {
    for (const { error, causedBy, groupKey, context } of errors) {
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
          ...(context && { context }),
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

- [ ] **Step 2: Update publishErrorEvent to accept optional RequestContext**

In `libs/event-processor/src/lambda/publish-error-event.ts`:

```typescript
import { logger, NotRetryableError } from '../internal';
import { getUUID, getTime } from '../platform/core';
import type { Bus } from '../platform/bus';
import type { ErrorEvent } from '../platform/errors';
import type { RequestContext } from '../domain/schemas';

/**
 * Publishes a non-retryable error as an ErrorEvent to EventBridge.
 * Optionally includes RequestContext for traceability.
 */
export async function publishErrorEvent(
  bus: Bus,
  errorEventType: string,
  error: unknown,
  context?: RequestContext,
): Promise<void> {
  if (!(error instanceof NotRetryableError)) return;

  const event: ErrorEvent = {
    id: getUUID(),
    timestamp: getTime(),
    type: errorEventType,
    ...(context && { context }),
    error: {
      name: error.name,
      message: error.message,
      ...(error.details && { details: error.details }),
    },
  };

  try {
    await bus.publish(event);
  } catch (pubErr) {
    logger.warn('Failed to publish error event', { pubErr, originalEvent: event });
  }
}
```

- [ ] **Step 3: withErrorPublishing — no changes needed**

The middleware calls `publishErrorEvent` but doesn't have access to `RequestContext` at the middleware level (it wraps the entire handler). The `context` parameter is optional, so the existing middleware continues to work without passing it. Services that need context on error events can call `publishErrorEvent` directly with the context.

- [ ] **Step 4: Run error publishing tests**

Run: `pnpm nx test event-processor --testPathPattern="error-event|error-collector"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add libs/event-processor/src/engine/error-event-publisher.ts libs/event-processor/src/lambda/publish-error-event.ts
git commit -m "feat(event-processor): add optional RequestContext to error event publishing"
```

---

## Task 7: Authorization — authorizeRequest

**Files:**
- Create: `libs/event-processor/src/lambda/authorize-request.ts`
- Delete: `libs/event-processor/src/lambda/authorize-tenant.ts`
- Modify: `libs/event-processor/src/lambda/index.ts`

- [ ] **Step 1: Write failing test for authorizeRequest**

Create `libs/event-processor/test/lambda/authorize-request.test.ts`:

```typescript
import { authorizeRequest } from '../../src/lambda/authorize-request';

describe('authorizeRequest', () => {
  const mockEvent = (tenantId?: string, sub?: string) => ({
    identity: {
      claims: {
        ...(tenantId && { 'custom:tenant_id': tenantId }),
        ...(sub && { sub }),
      },
    },
    info: { fieldName: 'test', selectionSetGraphQL: '' },
    arguments: {},
    source: null,
    request: { headers: {} },
    prev: null,
    stash: {},
  });

  it('should return RequestContext with branded types', () => {
    const ctx = authorizeRequest(mockEvent('tenant-123', 'user-456') as any, 'us-east-1');
    expect(ctx.tenantId).toBe('tenant-123');
    expect(ctx.userId).toBe('user-456');
    expect(ctx.region).toBe('us-east-1');
  });

  it('should throw NotRetryableError when tenantId is missing', () => {
    expect(() => authorizeRequest(mockEvent(undefined, 'user-456') as any, 'us-east-1'))
      .toThrow('UNAUTHORIZED: missing tenantId');
  });

  it('should throw NotRetryableError when userId is missing', () => {
    expect(() => authorizeRequest(mockEvent('tenant-123', undefined) as any, 'us-east-1'))
      .toThrow('UNAUTHORIZED: missing userId');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test event-processor --testPathPattern=authorize-request`
Expected: FAIL — module not found

- [ ] **Step 3: Implement authorizeRequest**

Create `libs/event-processor/src/lambda/authorize-request.ts`:

```typescript
import { AppSyncResolverEvent } from 'aws-lambda';
import { NotRetryableError } from '../internal';
import type { RequestContext } from '../domain/schemas';
import { asTenantId, asUserId } from '../platform/types/branded';

/**
 * Extracts and validates RequestContext from an AppSync resolver event's Cognito claims.
 * Throws NotRetryableError if tenantId or userId is missing.
 *
 * @param event - The AppSync resolver event
 * @param region - AWS region, injected via requireEnv('AWS_REGION') at wiring
 * @returns RequestContext with branded TenantId and UserId
 */
export function authorizeRequest(
  event: AppSyncResolverEvent<Record<string, unknown>>,
  region: string,
): RequestContext {
  const claims = event.identity as Record<string, unknown> | undefined;
  const claimsMap = claims?.['claims'] as Record<string, string> | undefined;
  const tenantId = claimsMap?.['custom:tenant_id'];
  const userId = claimsMap?.['sub'];

  if (!tenantId) {
    throw new NotRetryableError('UNAUTHORIZED: missing tenantId');
  }
  if (!userId) {
    throw new NotRetryableError('UNAUTHORIZED: missing userId');
  }

  return {
    tenantId: asTenantId(tenantId),
    userId: asUserId(userId),
    region,
  };
}
```

- [ ] **Step 4: Delete authorize-tenant.ts**

```bash
rm libs/event-processor/src/lambda/authorize-tenant.ts
```

- [ ] **Step 5: Update lambda barrel exports**

In `libs/event-processor/src/lambda/index.ts`:

```typescript
export { requireEnv } from './require-env';
export { authorizeRequest } from './authorize-request';
export { validateQueryDepth } from './validate-query-depth';
export { createServiceMetrics, MetricUnit } from './service-metrics';
export { publishErrorEvent } from './publish-error-event';

// Middleware
export { withErrorPublishing } from './middleware/with-error-publishing';
export { withMethodLogging } from './middleware/with-method-logging';

// Re-export internal middleware + utilities
export { applyMiddleware, withLambdaContext, withTiming } from '../internal';
export type { Middleware } from '../internal';
export { guardedWrite } from '../internal';
export { extractRequestContext } from '../internal';
export { traceEvent } from '../internal';

// Test utilities
export { evaluateResolver, createAuthContext } from './test-utils/evaluate-resolver';
export type { EvalContext } from './test-utils/evaluate-resolver';
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm nx test event-processor --testPathPattern=authorize-request`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add libs/event-processor/src/lambda/
git commit -m "feat(event-processor): add authorizeRequest, delete authorizeTenant"
```

---

## Task 8: Test Utilities, Barrel Exports & Fix Existing Tests

**Files:**
- Modify: `libs/event-processor/src/lambda/test-utils/evaluate-resolver.ts`
- Modify: `libs/event-processor/src/index.ts`
- Modify: various test files with `tenantId`-only context fixtures

- [ ] **Step 1: Fix createAuthContext claim key and add sub**

In `libs/event-processor/src/lambda/test-utils/evaluate-resolver.ts`, update `createAuthContext` (line 40-57):

```typescript
export function createAuthContext(
  tenantId: string,
  userId: string,
  overrides: Partial<EvalContext> = {},
): EvalContext {
  return {
    arguments: {},
    identity: {
      claims: {
        'custom:tenant_id': tenantId,
        'sub': userId,
      },
      username: `${userId}@example.com`,
    },
    stash: {},
    prev: { result: null },
    result: null,
    error: null,
    ...overrides,
  };
}
```

- [ ] **Step 2: Update main barrel exports (src/index.ts)**

In `libs/event-processor/src/index.ts`, update the relevant export sections:

Lambda utilities section (~line 99-111):
```typescript
// Lambda utilities (from lambda-utils)
export {
  requireEnv,
  authorizeRequest,
  validateQueryDepth,
  createServiceMetrics, MetricUnit,
  publishErrorEvent,
  withErrorPublishing,
  withMethodLogging,
  applyMiddleware, withLambdaContext, withTiming,
  type Middleware,
  guardedWrite, extractRequestContext, traceEvent,
  evaluateResolver, createAuthContext, type EvalContext,
} from './lambda';
```

Domain section (~line 113-126):
```typescript
// Domain (shared infrastructure types & errors)
export {
  DomainError,
  DomainValidationError,
  EntityNotFoundError,
  BusinessRuleViolationError,
  TenantAccessDeniedError,
  BusEventSchema,
  RequestContextSchema,
  parseRequestContext,
} from './domain';
export type {
  BusEventPayload,
  RequestContext,
} from './domain';
```

- [ ] **Step 3: Update fake-records.ts test helpers**

In `libs/event-processor/src/testing/fake-records.ts`, add `userId` and `region` to all three helpers:

**fakeSqsRecord** (line 7): Add opts `userId?: string; region?: string`, default `userId` to `'test-user'`, `region` to `'us-east-1'`. Update context (line 21):
```typescript
context: { tenantId, userId, region },
```

**fakeDdbStreamRecord** (lines 41-46): Add opts `userId?: string; region?: string`. Add defaults after `tenantId` (line 50):
```typescript
if (opts?.userId && !image.userId) image.userId = opts.userId;
if (!image.userId) image.userId = 'test-user';
if (opts?.region && !image.region) image.region = opts.region;
if (!image.region) image.region = 'us-east-1';
```

**fakeKinesisRecord** (line 79): Add opts `userId?: string; region?: string`, default `userId` to `'test-user'`, `region` to `'us-east-1'`. Update context (line 88):
```typescript
context: { tenantId, userId, region },
```

- [ ] **Step 4: Fix test fixtures across event-processor tests**

Update all test files that create events with `context: { tenantId: ... }` to include `userId` and `region`. These are the exact files (all paths relative to `libs/event-processor/`):

1. `test/domain/schemas.test.ts` — already updated in Task 1
2. `test/engine/ingestion-engine.test.ts` — add `userId` and `region` to event context fixtures
3. `test/engine/parse-sqs-record.test.ts` — add `userId` and `region` to SQS event body context
4. `test/engine/parse-kinesis-record.test.ts` — add `userId` and `region` to Kinesis event context
5. `test/engine/kinesis-adapter.test.ts` — add `userId` and `region` to event fixtures
6. `test/engine/ingestion-types.test.ts` — add `userId` and `region` if event fixtures exist
7. `test/pipelines/resume-state-machine.test.ts` — add `userId` and `region` to event context
8. `test/pipelines/change-data-capture.test.ts` — add `userId` and `region` to DDB image fixtures
9. `test/util/to-uow.test.ts` — add `userId` and `region` to `EventContext` fixture (now required)
10. `test/testing/test-harness.test.ts` — add `userId` and `region` to event fixtures

For each file, apply two changes:

**Change A** — Event payload contexts:
```typescript
// Before:
context: { tenantId: 'some-id' }
// After:
context: { tenantId: 'some-id', userId: 'some-user-id', region: 'us-east-1' }
```

**Change B** — `EventContext` object fixtures (where `userId` was optional and `region` didn't exist):
```typescript
// Before:
const ctx: EventContext = { eventId: '...', eventType: '...', tenantId: '...', timestamp: '...', serviceName: '...' };
// After:
const ctx: EventContext = { eventId: '...', eventType: '...', tenantId: '...', userId: 'test-user', region: 'us-east-1', timestamp: '...', serviceName: '...' };
```

- [ ] **Step 5: Run full event-processor test suite**

Run: `pnpm nx test event-processor`
Expected: ALL PASS

- [ ] **Step 6: Fix any remaining compilation or test failures**

Address any failures found in Step 5 — likely missing `userId`/`region` in test fixtures or imports referencing deleted exports.

- [ ] **Step 7: Commit**

```bash
git add libs/event-processor/
git commit -m "feat(event-processor): update barrel exports, fix test fixtures for RequestContext"
```

---

## Task 9: Service Migration — Ledger BFF

**Files:**
- Modify: `services/ledger/ledger-bff/src/handlers/graphql-resolver.ts`
- Modify: `services/ledger/ledger-bff/test/handlers/graphql-resolver.test.ts`
- Modify: `services/ledger/ledger-bff/src/graphql/js-function/utils/check-auth.fn.js`
- Modify: `services/ledger/ledger-bff/src/transforms/balance-updated.ts`
- Modify: `services/ledger/ledger-bff/src/transforms/portfolio-updated.ts`
- Modify: `services/ledger/ledger-bff/src/transforms/ledger-entry-recorded.ts`

- [ ] **Step 0: PREREQUISITE — Verify Cognito claim key**

Before updating any `check-auth.fn.js`, verify which claim key Cognito actually sends. The Lambda path (`authorizeTenant`) uses `custom:tenant_id` (snake_case), while the JS pipeline resolvers use `custom:tenantId` (camelCase). Only ONE can be correct.

Check the Cognito User Pool configuration for the custom attribute name. If both keys work (Cognito sends both), document that. If only one works, all paths must use that key.

**This MUST be verified before proceeding.** If you cannot verify (e.g., no Cognito access), flag it for the user.

- [ ] **Step 1: Update graphql-resolver.ts**

In `services/ledger/ledger-bff/src/handlers/graphql-resolver.ts`:

Update imports (line 4-13):
```typescript
import {
  requireEnv,
  authorizeRequest,
  validateQueryDepth,
  applyMiddleware,
  withLambdaContext,
  withTiming,
  withErrorPublishing,
  EventBridgeBus,
  type RequestContext,
} from '@nestfolio/event-processor';
```

Update `ResolverDeps` interface:
```typescript
interface ResolverDeps {
  readonly repository: PortfolioRepository;
  readonly timeTravelService: TimeTravelService;
  readonly region: string;
}
```

Update resolver to use `authorizeRequest`:
```typescript
const ctx = authorizeRequest(event, deps.region);
const { tenantId } = ctx;
```

Update wiring block:
```typescript
const REGION = requireEnv('AWS_REGION');
const TABLE_NAME = requireEnv('TABLE_NAME');
const bus = new EventBridgeBus(requireEnv('BUS_NAME'), 'ledger-bff');
const repository = new PortfolioRepository(TABLE_NAME, new DynamoDBClient({}));
const timeTravelService = new TimeTravelService(repository);
const deps: ResolverDeps = { repository, timeTravelService, region: REGION };
```

- [ ] **Step 2: Update graphql-resolver.test.ts**

In `services/ledger/ledger-bff/test/handlers/graphql-resolver.test.ts`, update the mock:

Replace the `authorizeTenant` mock (around line 52-57):
```typescript
  authorizeRequest: (event: { identity?: Record<string, unknown> }, region: string) => {
    const claims = event.identity as Record<string, unknown> | undefined;
    const claimsMap = claims?.['claims'] as Record<string, string> | undefined;
    const tenantId = claimsMap?.['custom:tenant_id'];
    const userId = claimsMap?.['sub'];
    if (!tenantId) throw new MockNotRetryableError('UNAUTHORIZED: missing tenantId');
    if (!userId) throw new MockNotRetryableError('UNAUTHORIZED: missing userId');
    return { tenantId, userId, region };
  },
```

Update `createResolver` call to pass `region`:
```typescript
resolver = createResolver({ repository, timeTravelService, region: 'us-east-1' });
```

- [ ] **Step 3: Update check-auth.fn.js**

In `services/ledger/ledger-bff/src/graphql/js-function/utils/check-auth.fn.js`:

```javascript
import { util } from '@aws-appsync/utils';

export function request(ctx) {
  // IMPORTANT: use the claim key verified in Step 0
  const tenantId = ctx.identity?.claims?.['custom:tenant_id'];
  const userId = ctx.identity?.claims?.['sub'];
  if (!tenantId || !userId) { util.unauthorized(); }
  ctx.stash.tenantId = tenantId;
  ctx.stash.userId = userId;
  ctx.stash.region = ctx.env?.AWS_REGION ?? 'us-east-1';
  return {};
}

export function response(ctx) { return ctx.prev.result; }
```

- [ ] **Step 4: Update transforms to use typed context**

In each of the 3 transform files, replace the cast pattern:
- `balance-updated.ts` (line 19)
- `portfolio-updated.ts` (line 26)
- `ledger-entry-recorded.ts` (line 29)

Replace:
```typescript
const tenantId = (event.context as Record<string, string>).tenantId;
```
With:
```typescript
const { tenantId, userId, region } = event.context;
```

Then spread `userId` and `region` into `record()` / `project()` intent builder calls alongside `tenantId`.

- [ ] **Step 5: Run ledger-bff tests**

Run: `pnpm nx test ledger-bff`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add services/ledger/ledger-bff/
git commit -m "feat(ledger-bff): migrate to authorizeRequest and RequestContext"
```

---

## Task 10: Service Migration — Dashboard BFF

**Files:**
- Modify: `services/investor/dashboard-bff/src/graphql/js-function/utils/check-auth.fn.js`
- Modify: `services/investor/dashboard-bff/src/transforms/portfolio-summary.ts`
- Modify: `services/investor/dashboard-bff/src/transforms/time-travel-availability.ts`
- Modify: `services/investor/dashboard-bff/src/transforms/recent-activity.ts`
- Modify: `services/investor/dashboard-bff/src/transforms/position-snapshot.ts`
- Modify: `services/investor/dashboard-bff/src/transforms/investor-snapshot.ts`
- Modify: `services/investor/dashboard-bff/src/transforms/advisory-status.ts`

Note: `dashboard-bff` has NO Lambda-based graphql-resolver.ts — only JS pipeline resolvers.

- [ ] **Step 1: Update check-auth.fn.js**

Same pattern as Task 9 Step 3 — extract `userId` from `sub` claim, stash `region`.

- [ ] **Step 2: Update all 6 transforms**

Replace `(event.context as Record<string, string>).tenantId` with typed `event.context` destructuring in each of these files:
- `portfolio-summary.ts` (line 17)
- `time-travel-availability.ts` (line 8)
- `recent-activity.ts` (line 17)
- `position-snapshot.ts` (line 23)
- `investor-snapshot.ts` (line 8)
- `advisory-status.ts` (line 8)

In each, replace:
```typescript
const tenantId = (event.context as Record<string, string>).tenantId;
```
With:
```typescript
const { tenantId, userId, region } = event.context;
```

Then spread `userId` and `region` into any `record()` / `project()` intent builder calls.

- [ ] **Step 3: Run dashboard-bff tests**

Run: `pnpm nx test dashboard-bff`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add services/investor/dashboard-bff/
git commit -m "feat(dashboard-bff): migrate to RequestContext"
```

---

## Task 11: Service Migration — Investor BFF, Advisory BFF & Onboarding BFF

**Files:**
- Modify: `services/investor/investor-bff/src/graphql/js-function/utils/check-auth.fn.js`
- Modify: `services/advisory/advisory-bff/src/graphql/js-function/utils/check-auth.fn.js`
- Modify: `services/investor/onboarding-bff/src/handlers/event-publisher.ts`
- Modify: any transforms in these services that use the context cast pattern

Note: Neither `investor-bff` nor `advisory-bff` has a Lambda-based `graphql-resolver.ts` — only JS pipeline resolvers.

- [ ] **Step 1: Update investor-bff check-auth.fn.js**

Same pattern as Task 9 Step 3.

- [ ] **Step 2: Update advisory-bff check-auth.fn.js**

Same pattern as Task 9 Step 3.

- [ ] **Step 3: Audit onboarding-bff**

Read `services/investor/onboarding-bff/src/handlers/event-publisher.ts` and any other handlers. This is a LangGraph-based service. Check:
- How does it receive requests? (API Gateway? AppSync? Direct Lambda invoke?)
- How is `tenantId` currently extracted?
- Where should `RequestContext` be initialized?
- Update any `event.context` references and CDC event publishers.

- [ ] **Step 4: Update any transforms with context cast pattern**

Search for `event.context as Record` in all three services and update to typed destructuring.

- [ ] **Step 5: Run tests**

Run: `pnpm nx test investor-bff && pnpm nx test advisory-bff && pnpm nx test onboarding-bff`
Expected: PASS (some may not have tests — note and continue)

- [ ] **Step 6: Commit**

```bash
git add services/investor/investor-bff/ services/advisory/advisory-bff/ services/investor/onboarding-bff/
git commit -m "feat(investor-bff, advisory-bff, onboarding-bff): migrate to RequestContext"
```

---

## Task 12: Remaining Service Imports & Compile Check

**Files:**
- Any other services importing `authorizeTenant`, `authorizeUser`, `extractTenantId`, `TenantContext`, `TenantContextSchema`, `BusEventType`, or `AuthorizedIdentity`

- [ ] **Step 1: Search for stale imports across the monorepo**

```bash
pnpm nx run-many -t build --all 2>&1 | head -100
```

Or grep for stale imports:
```bash
grep -r "authorizeTenant\|authorizeUser\|extractTenantId\|TenantContext\|BusEventType\|AuthorizedIdentity" services/ libs/ --include='*.ts' -l
```

- [ ] **Step 2: Fix each stale import**

For each file found:
- `authorizeTenant` / `authorizeUser` → `authorizeRequest`
- `extractTenantId` → `extractRequestContext`
- `TenantContext` → `RequestContext`
- `TenantContextSchema` → `RequestContextSchema`
- `BusEventType` → `BusEventPayload`
- `AuthorizedIdentity` → remove (use `RequestContext` directly)

- [ ] **Step 3: Full monorepo build check**

Run: `pnpm nx run-many -t build --all`
Expected: ALL PASS

- [ ] **Step 4: Full monorepo test check**

Run: `pnpm nx run-many -t test --all`
Expected: ALL PASS

- [ ] **Step 5: Commit any remaining fixes**

```bash
git add -A
git commit -m "fix: resolve remaining stale imports after RequestContext migration"
```
