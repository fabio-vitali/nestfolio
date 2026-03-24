# Request Context Pattern — Design Spec

## Problem

Cross-cutting concerns (tenant identity, user identity, region) are threaded manually and inconsistently through the system. `tenantId` is hardcoded in `TableEntry`, extracted ad-hoc via `authorizeTenant`, and cast from `Record<string, string>` in event handlers. `userId` and `region` are not propagated at all. There is no single typed context object that flows from BFF entry point through DynamoDB rows, CDC events, and downstream consumers.

## Solution

Introduce `RequestContext` — a typed context object initialized once at the BFF handler boundary and propagated through the entire system via the second generic parameter (`S`) on `BusEvent<T, S>` and `TableEntry<T, S>`.

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Context fields | `tenantId`, `userId`, `region` | Core cross-cutting triple. Domain-specific fields belong in `subject`, not `context`. |
| Extension mechanism | None (flat type, no per-domain extensions) | `subject` already carries domain data. Extensions would duplicate. |
| Type structure | Intersection via generics (`& S`) | Mirrors shape-services pattern. Flat, type-safe, no runtime overhead. |
| Location | `libs/event-processor` | Cross-cutting type used by all services. Already centralizes event/table types. |
| Branded types | `TenantId`, `UserId` (existing branded types) | Compile-time safety — prevents accidental ID swaps across the system. `region` stays plain `string`. |
| Initialization | `authorizeRequest(event, region)` replaces `authorizeTenant` + `authorizeUser` | Single function, single call site. `region` injected via `requireEnv('AWS_REGION')` at wiring, not read from `process.env` inside the function. |
| Backward compat | None needed | System not yet deployed. Clean cut. |

## Type Definitions

### RequestContext

In `libs/event-processor/src/domain/schemas.ts`:

```typescript
import { TenantId, UserId, asTenantId, asUserId } from '../platform/types/branded';

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
```

Replaces `TenantContext` and `TenantContextSchema` entirely.

The `parseRequestContext` bridge function solves the Zod/branded type gap: `RequestContextSchema` infers plain `string` fields (for runtime validation), while `RequestContext` uses branded `TenantId`/`UserId` (for compile-time safety). The bridge parses with Zod then casts to branded types.

### BusEvent (platform)

In `libs/event-processor/src/platform/bus.ts`:

```typescript
export type BusEvent<T = object, S = RequestContext> = Event & {
  subject: T;
  context: S;
};
```

Default generic changed from `Record<string, unknown>` to `RequestContext`.

### BusEventSchema (domain — Zod-inferred)

In `libs/event-processor/src/domain/schemas.ts`, the Zod-inferred type is renamed to avoid collision with the generic platform type:

```typescript
export const BusEventSchema = z.object({
  id: z.string().uuid(),
  type: z.string().min(1),
  timestamp: z.string().datetime(),
  subject: z.record(z.unknown()),
  context: RequestContextSchema,
});

// Renamed from BusEvent to avoid collision with generic BusEvent<T,S> in platform
export type BusEventPayload = z.infer<typeof BusEventSchema>;
```

The barrel export `BusEventType` (currently aliasing the Zod-inferred `BusEvent`) is updated to re-export `BusEventPayload`.

### TableEntry

In `libs/event-processor/src/platform/table.ts`:

```typescript
export type TableEntry<T = Record<string, unknown>, S = RequestContext> = T & {
  pk: string;
  sk: string;
  __typename: string;
  timestamp: string;
  ttl?: number;
} & S;
```

Hardcoded `tenantId` removed — it comes from `S`. `userId` and `region` are also flattened into every row via `S`.

### ErrorEvent

In `libs/event-processor/src/platform/errors.ts`, `ErrorEvent` updated to carry `RequestContext`:

```typescript
export type ErrorEvent = {
  id: string;
  type: string;
  timestamp: string;
  context: RequestContext;
  error: {
    name: string;
    message: string;
    details?: Record<string, unknown>;
  };
};
```

This ensures error paths don't break the context chain. Error event publishers (`publishErrorEvent`, `withErrorPublishing`, `ErrorEventPublisher`) updated to accept and propagate `RequestContext`.

## Context Initialization

### authorizeRequest

In `libs/event-processor/src/lambda/authorize-request.ts` (replaces `authorize-tenant.ts`):

```typescript
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

Claims access path: `event.identity['claims']['custom:tenant_id']` — matches the existing `authorizeTenant` implementation (NOT `event.identity.claims` directly).

Delete `authorize-tenant.ts` (`authorizeTenant` and `authorizeUser`) entirely. Delete `AuthorizedIdentity` type.

### BFF Wiring (Lambda resolvers)

Only `ledger-bff` currently uses a Lambda-based GraphQL resolver. Its wiring block adds `REGION`:

```typescript
const REGION = requireEnv('AWS_REGION');
const TABLE_NAME = requireEnv('TABLE_NAME');
// ...
```

`REGION` is passed into `ResolverDeps` and used by the resolver when calling `authorizeRequest(event, deps.region)`.

### BFF Wiring (JS pipeline resolvers)

Four BFFs use AppSync JS pipeline resolvers with `check-auth.fn.js`:
- `investor-bff`, `dashboard-bff`, `advisory-bff`, `ledger-bff`

These run in the AppSync JavaScript runtime (not Lambda). Auth is handled by `check-auth.fn.js` which accesses `ctx.identity?.claims?.['custom:tenantId']`. These resolvers extract `tenantId` and pass it via `ctx.stash`.

Migration: update `check-auth.fn.js` to also extract `userId` from `ctx.identity?.claims?.sub` (the Cognito `sub` claim — a UUID, consistent with `authorizeRequest` in the Lambda path) and stash `region` (passed as an environment variable to the AppSync API). All three values propagate through the JS pipeline via `ctx.stash`. Note: existing `check-auth.fn.js` extracts username via `username.split('@')[0]` — this is NOT the same as `sub` and should not be used for `UserId`.

Note: `check-auth.fn.js` uses `custom:tenantId` (camelCase) while `authorizeTenant` uses `custom:tenant_id` (snake_case). Verify which claim key Cognito actually uses and align both paths.

## Pipeline Updates

### toUow

In `libs/event-processor/src/util/to-uow.ts`:

```typescript
context: payload.context ?? {
  tenantId: ctx.tenantId,
  userId: ctx.userId,
  region: ctx.region,
},
```

`EventContext` type updated to add `region` field (`userId` already exists as optional — make it required).

### unmarshalStream

In `libs/event-processor/src/util/unmarshal-stream.ts`, extract `userId` and `region` from the unmarshalled DDB image alongside `tenantId`:

```typescript
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
```

### changeDataCapture

In `libs/event-processor/src/pipelines/change-data-capture.ts`, `buildEntry` extracts full context from the stream record:

```typescript
context: {
  tenantId: record.tenantId,
  userId: record.userId,
  region: record.region,
},
```

### StreamRecord and StreamContext Types

In `libs/event-processor/src/types/stream-types.ts`, add `userId` and `region` to both types:

```typescript
// StreamRecord
readonly userId: string;
readonly region: string;

// StreamContext
readonly userId: string;
readonly region: string;
```

### extractTenantId → extractRequestContext

In `libs/event-processor/src/internal/extract-tenant-id.ts`, evolve to extract full `RequestContext`:

```typescript
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

Delete `extractTenantId`. All call sites switch to `extractRequestContext`.

### traceEvent

In `libs/event-processor/src/internal/trace-event.ts`, add `UserId` annotation:

```typescript
export function traceEvent(eventType: string, eventId: string, tenantId?: string, userId?: string): void {
  try {
    tracer.putAnnotation('EventType', eventType);
    tracer.putAnnotation('EventId', eventId);
    if (tenantId) tracer.putAnnotation('TenantId', tenantId);
    if (userId) tracer.putAnnotation('UserId', userId);
  } catch {
    // Silently ignore tracing errors
  }
}
```

### Write Intent Builders

`record()`, `project()`, and other intent builders produce `TableEntry` objects. Since `RequestContext` fields are now part of `TableEntry` via the generic, handlers must include context fields when building intents. Handlers already have access to the event's `context` — they spread it into the row fields.

## Service Migration

### Lambda BFF Handlers (ledger-bff)
- `authorizeTenant(event)` / `authorizeUser(event)` → `authorizeRequest(event, deps.region)`
- Add `REGION = requireEnv('AWS_REGION')` to wiring block
- Add `region` to `ResolverDeps` interface
- Thread `RequestContext` to downstream calls

### JS Pipeline Resolver BFFs (investor-bff, dashboard-bff, advisory-bff, ledger-bff)
- Update `check-auth.fn.js` to extract `userId` and `region` into `ctx.stash`
- Downstream resolver functions read from `ctx.stash` and include in mutations/writes

### Onboarding BFF (onboarding-bff)
- LangGraph-based — context initialization depends on how requests enter. Audit entry point and propagate `RequestContext` accordingly.

### Event Listeners / Transforms (~10+ services)
- Remove `(event.context as Record<string, string>).tenantId` casts — use `extractRequestContext(event)` or typed `event.context: RequestContext`
- When building `WriteIntent`s, spread context fields into the row

### CDC Event Publishers (~4 services)
- No per-service changes — shared `changeDataCapture` pipeline handles it

### Repositories
- Keep taking `tenantId: string` (or `TenantId`) for key construction — repositories don't need `userId` or `region` for queries. Callers destructure from `RequestContext`.

## Testing Utilities

### createAuthContext

In `libs/event-processor/src/lambda/test-utils/evaluate-resolver.ts`, update to produce full `RequestContext`-compatible claims:

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
        'custom:tenant_id': tenantId,  // Fix: was 'custom:tenantId' (camelCase)
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

Fix pre-existing bug: claim key was `custom:tenantId` (camelCase), should be `custom:tenant_id` (snake_case) to match `authorizeTenant`/`authorizeRequest` implementation.

## Context Flow (End-to-End)

```
BFF Handler
  └─ authorizeRequest(event, region) → RequestContext { tenantId, userId, region }
       │
       ├─ DynamoDB Write (TableEntry<T, RequestContext>)
       │    └─ tenantId, userId, region flattened into row
       │         │
       │         └─ DDB Stream → unmarshalStream (extracts tenantId, userId, region)
       │              └─ changeDataCapture → buildEntry
       │                   └─ BusEvent.context = { tenantId, userId, region }
       │                        │
       │                        └─ EventBridge → Downstream Consumer
       │                             └─ event.context: RequestContext (typed, branded)
       │                             └─ extractRequestContext(event) for typed access
       │
       ├─ Direct Event Publish (BusEvent<T, RequestContext>)
       │    └─ context = RequestContext from authorizeRequest
       │
       └─ Error Path
            └─ ErrorEvent.context = RequestContext
                 └─ withErrorPublishing propagates context to error events
```

## Validation

- `RequestContextSchema` validates all three fields at ingestion boundaries (SQS pipeline)
- `parseRequestContext` bridges Zod validation → branded types
- Every incoming event's `context` is validated against the schema before processing

## Files Changed

### libs/event-processor
- `src/domain/schemas.ts` — `RequestContext`, `RequestContextSchema`, `parseRequestContext` (replaces `TenantContext`); rename Zod-inferred `BusEvent` → `BusEventPayload`
- `src/platform/bus.ts` — `BusEvent` default generic → `RequestContext`
- `src/platform/table.ts` — `TableEntry` made generic with `S = RequestContext`
- `src/platform/errors.ts` — `ErrorEvent` gains `context: RequestContext`
- `src/types/event-context.ts` — add `userId`, `region` to `EventContext`
- `src/types/stream-types.ts` — add `userId`, `region` to `StreamRecord` and `StreamContext`
- `src/util/to-uow.ts` — full context in fallback
- `src/util/unmarshal-stream.ts` — extract `userId`, `region` from DDB image
- `src/pipelines/change-data-capture.ts` — full context extraction from stream record
- `src/internal/extract-tenant-id.ts` — rename to `extract-request-context.ts`, returns `RequestContext`
- `src/internal/trace-event.ts` — add `UserId` X-Ray annotation
- `src/lambda/authorize-tenant.ts` — replaced by `authorize-request.ts` (`authorizeRequest`)
- `src/lambda/test-utils/evaluate-resolver.ts` — fix claim key, update `createAuthContext`
- `src/lambda/middleware/with-error-publishing.ts` — propagate `RequestContext` to error events
- `src/engine/error-event-publisher.ts` — accept and include `RequestContext`
- `src/lambda/publish-error-event.ts` — accept and include `RequestContext`
- `src/index.ts` — update exports

### BFF services
- `ledger-bff` — Lambda resolver: `authorizeRequest`, add `REGION` to wiring
- `investor-bff`, `dashboard-bff`, `advisory-bff`, `ledger-bff` — JS pipeline: update `check-auth.fn.js`
- `onboarding-bff` — audit entry point, propagate context

### Event listener services (~10+)
- Transforms: typed context access via `extractRequestContext`, spread into intents

### CDC services (~4)
- No per-service changes (shared pipeline handles it)
