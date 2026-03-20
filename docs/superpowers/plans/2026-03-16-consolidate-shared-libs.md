# Consolidate Shared Libraries — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate `@nestfolio/platform-core`, `@nestfolio/lambda-utils`, and `@nestfolio/domain-core` by consolidating everything into `@nestfolio/event-processor` (the single shared backend library). Domain events/schemas/models move to their publishing services.

**Architecture:** Event-processor already has self-contained `internal/` copies of many platform-core and lambda-utils modules (errors, logger, tracer, middleware, sqs-parser, etc.). We promote these to the public API and add what's missing. Publisher-owns-events principle distributes domain events to services. Consumer services import event type constants from the producer via `@nestfolio/<service>/domain` tsconfig path aliases.

**Tech Stack:** TypeScript, Zod, Nx, Jest, AWS CDK

---

## Current State

| Library | Exports | Consumers (source files) | Test mocks |
|---------|---------|--------------------------|------------|
| **platform-core** | 28 exports (types, errors, logger, tracer, repos, FP, branded, market-data) | ~60 service files + lambda-utils + command-core | 47 test files |
| **lambda-utils** | 23 exports (re-exports 6 from platform-core + middleware, auth, metrics, etc.) | ~36 service files + cdk-constructs | 47 test files |
| **domain-core** | ~40 exports (events, schemas, models per domain) | ~7 source files | 24 test files |
| **event-processor** | 30+ exports (pipelines, intents, engines) + self-contained `internal/` modules | all 11 event-listeners | 0 mocks |

## Target State

| Library | Role |
|---------|------|
| **event-processor** | Single shared backend lib: pipelines + platform types + Lambda utilities + domain infrastructure |
| **command-core** | Command/reducer infrastructure (switches platform-core → event-processor import) |
| **cdk-constructs** | CDK constructs (switches lambda-utils → event-processor import) |
| Per-service `src/domain/` | Events, schemas, models owned by each publishing service |

---

## Event-processor Module Organization (target)

```
libs/event-processor/src/
├── index.ts                    (barrel — all public exports)
├── engine/                     (existing — SQS/Stream engines)
├── intents/                    (existing — DDB write intents)
├── pipelines/                  (existing — handler factories)
├── types/                      (existing — core interfaces)
├── util/                       (existing — async, grouping, CSV, CDC)
├── testing/                    (existing — test harnesses + fakes)
├── internal/                   (existing — self-contained implementations)
├── platform/                   (NEW — from platform-core)
│   ├── core.ts                 (Event, Pipe, UnitOfWork, envVar)
│   ├── bus.ts                  (BusEvent, Bus, EventBridgeBus)
│   ├── errors.ts               (handleClientError, ErrorEvent)
│   ├── table.ts                (TableEntry)
│   ├── logger.ts               (log decorator — re-uses internal/logger singleton)
│   ├── validation.ts           (validateIncomingEvent)
│   ├── fp/
│   │   ├── pipe.ts             (value-first pipe)
│   │   └── result.ts           (Result type + combinators)
│   ├── types/
│   │   └── branded.ts          (TenantId, UserId, EventId)
│   ├── repositories/
│   │   ├── table.repository.ts
│   │   ├── event.repository.ts
│   │   └── bucket.repository.ts
│   └── market-data/
│       ├── market-data-client.ts
│       ├── cached-market-data.ts
│       └── index.ts
├── lambda/                     (NEW — from lambda-utils)
│   ├── require-env.ts
│   ├── authorize-tenant.ts
│   ├── validate-query-depth.ts
│   ├── container.ts
│   ├── service-metrics.ts
│   ├── publish-error-event.ts
│   ├── event-publisher.ts      (DDB→EB Lambda handler)
│   ├── middleware/
│   │   ├── with-error-publishing.ts
│   │   └── with-method-logging.ts
│   └── test-utils/
│       └── evaluate-resolver.ts
└── domain/                     (NEW — from domain-core shared)
    ├── errors.ts               (DomainError hierarchy)
    ├── schemas.ts              (BusEventSchema, TenantContextSchema)
    └── index.ts
```

---

## Publisher → Event Ownership Map

| Publisher Service | Event Type Constants Object | Events |
|---|---|---|
| **investor-bff** | `InvestorBffEventTypes` | USER_REGISTERED, ONBOARDING_COMPLETED, GOAL_SET, GOAL_UPDATED, RISK_PROFILE_SET, RISK_PROFILE_UPDATED, MANDATE_GRANTED, MANDATE_UPDATED, MANDATE_REVOKED, OPERATING_MODE_SELECTED, OPERATING_MODE_CHANGED, DEPOSIT_INITIATED, WITHDRAWAL_REQUESTED, ACCOUNT_CLOSURE_REQUESTED, ACCOUNT_CLOSED, BROKER_AUTHORIZATION_REVOKED, NOTIFICATION_READ, USER_AUTHENTICATED, USER_SESSION_EXPIRED, USER_DELETION_REQUESTED, PII_REMOVED, TENANT_ANONYMIZED, ONBOARDING_ANSWER_RECORDED |
| **investor-ctrl** | `InvestorCtrlEventTypes` | NOTIFICATION_CREATED, NOTIFICATION_SENT, NOTIFICATION_DELIVERED, MONTHLY_REPORT_GENERATED |
| **advisory-ctrl** | `AdvisoryCtrlEventTypes` | AGENT_INVOCATION_STARTED, AGENT_INVOCATION_COMPLETED, AGENT_EXECUTION_FAILED, GOAL_INTERPRETATION_PRODUCED, RISK_EVALUATION_PRODUCED, MARKET_SIGNAL_DETECTED, PORTFOLIO_CONSTRUCTION_PROPOSED, REBALANCE_PLAN_PRODUCED, RECOMMENDATION_PROPOSED, EXPLANATION_GENERATED, DECISION_PACKET_CREATED, DECISION_PACKET_ENRICHED, USER_CONFIRMATION_REQUESTED, INCIDENT_DETECTED, INCIDENT_CONTAINED, INCIDENT_ESCALATED, INCIDENT_RESOLVED, CIRCUIT_BREAKER_TRIGGERED, CIRCUIT_BREAKER_RESET, HEALTH_CHECK_COMPLETED, MODEL_REGISTERED, SHADOW_RUN_STARTED, SHADOW_RUN_COMPLETED, MODEL_PROMOTION_REQUESTED, MODEL_PROMOTION_APPROVED, MODEL_PROMOTED, MODEL_ROLLBACK_TRIGGERED, TENANT_BUDGET_APPROACHING, TENANT_BUDGET_EXCEEDED, REASONING_TIER_CHANGED, OPERATOR_ACTION_PERFORMED, EVENT_DELIVERY_FAILED, EVENT_REPLAYED |
| **advisory-bff** | `AdvisoryBffEventTypes` | USER_CONFIRMED, USER_REJECTED, USER_VIEWED_EXPLANATION |
| **compliance-ctrl** | `ComplianceEventTypes` | DECISION_APPROVED, DECISION_BLOCKED, GUARDRAIL_VIOLATION_DETECTED, ESCALATION_TRIGGERED, COMPLIANCE_APPROVAL_GRANTED, AUDIT_ARTIFACT_CREATED, SUITABILITY_CHECK_PASSED, SUITABILITY_CHECK_FAILED |
| **execution-ctrl** | `ExecutionCtrlEventTypes` | ORDER_SUBMITTED, ORDER_STAGED, EXECUTION_PAUSED, EXECUTION_RESUMED |
| **execution-adpt** | `ExecutionAdptEventTypes` | ORDER_ACCEPTED, ORDER_PARTIALLY_FILLED, ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, PORTFOLIO_SNAPSHOT_IMPORTED, BROKER_SESSION_ESTABLISHED, BROKER_SESSION_LOST, STREAM_CONNECTED, STREAM_DISCONNECTED, BROKER_AUTHORIZATION_REVOKED, DEPOSIT_DETECTED, WITHDRAWAL_SUBMITTED, WITHDRAWAL_COMPLETED, WITHDRAWAL_REJECTED |
| **ledger-ctrl** | `LedgerCtrlEventTypes` | BALANCE_UPDATED, PORTFOLIO_UPDATED, LEDGER_ENTRY_RECORDED, LEDGER_PROCESSING_FAILED, LEDGER_SIMULATION_FAILED |
| **reconciliation-ctrl** | `ReconciliationEventTypes` | PORTFOLIO_DRIFT_DETECTED, RECONCILIATION_REQUIRED, RECONCILIATION_STARTED, RECONCILIATION_COMPLETED, RECONCILIATION_FAILED, RECONCILIATION_LOCK_ACQUIRED, RECONCILIATION_LOCK_RELEASED, PROJECTION_REBUILT, CORPORATE_ACTION_APPLIED |

## Consumer → Producer Import Map

| Consumer | Imports From |
|---|---|
| **investor-bff** | own events + `@nestfolio/investor-ctrl/domain` + `@nestfolio/ledger-ctrl/domain` |
| **investor-ctrl** | `@nestfolio/investor-bff/domain` + `@nestfolio/compliance-ctrl/domain` + `@nestfolio/execution-adpt/domain` + `@nestfolio/ledger-ctrl/domain` |
| **dashboard-bff** | `@nestfolio/ledger-ctrl/domain` + `@nestfolio/reconciliation-ctrl/domain` + `@nestfolio/advisory-ctrl/domain` + `@nestfolio/compliance-ctrl/domain` + `@nestfolio/investor-bff/domain` |
| **advisory-ctrl** | `@nestfolio/investor-bff/domain` + `@nestfolio/advisory-bff/domain` + `@nestfolio/compliance-ctrl/domain` + `@nestfolio/execution-adpt/domain` + `@nestfolio/reconciliation-ctrl/domain` |
| **advisory-bff** | `@nestfolio/advisory-ctrl/domain` + `@nestfolio/compliance-ctrl/domain` |
| **compliance-ctrl** | `@nestfolio/advisory-ctrl/domain` + `@nestfolio/investor-bff/domain` |
| **execution-ctrl** | `@nestfolio/compliance-ctrl/domain` + `@nestfolio/advisory-bff/domain` + `@nestfolio/advisory-ctrl/domain` + `@nestfolio/investor-bff/domain` |
| **execution-adpt** | `@nestfolio/execution-ctrl/domain` + `@nestfolio/investor-bff/domain` |
| **ledger-ctrl** | `@nestfolio/execution-adpt/domain` + `@nestfolio/advisory-ctrl/domain` |
| **ledger-bff** | `@nestfolio/ledger-ctrl/domain` |
| **reconciliation-ctrl** | `@nestfolio/ledger-ctrl/domain` + `@nestfolio/execution-adpt/domain` |

## Schema Ownership (publisher-owns)

| Schema | Publisher |
|---|---|
| MandateGrantedSchema, GoalUpdatedSchema, RiskProfileUpdatedSchema, OnboardingCompletedSchema, DepositInitiatedSchema | **investor-bff** |
| DecisionPacketCreatedSchema, UserConfirmationRequestedSchema | **advisory-ctrl** |
| DecisionApprovedSchema, DecisionBlockedSchema | **compliance-ctrl** |
| OrderSubmittedSchema | **execution-ctrl** |
| OrderFilledSchema, DepositDetectedSchema | **execution-adpt** |
| PortfolioDriftDetectedSchema | **reconciliation-ctrl** |

---

## Chunk 1: Expand event-processor — platform modules

Add platform-core modules to event-processor under `src/platform/`. These modules are adapted to use event-processor's existing `internal/` singletons (logger, tracer) instead of creating their own.

### Task 1: Add core types (Event, Pipe, UnitOfWork, envVar, TableEntry)

**Files:**
- Create: `libs/event-processor/src/platform/core.ts`
- Create: `libs/event-processor/src/platform/table.ts`

- [ ] **Step 1: Create core.ts**

Copy `libs/platform-core/src/core.ts` verbatim to `libs/event-processor/src/platform/core.ts`. The module is self-contained (only depends on `node:crypto`).

- [ ] **Step 2: Create table.ts**

Copy `libs/platform-core/src/table.ts` verbatim to `libs/event-processor/src/platform/table.ts`.

- [ ] **Step 3: Commit**

```bash
git add libs/event-processor/src/platform/core.ts libs/event-processor/src/platform/table.ts
git commit -m "feat(event-processor): add core types and TableEntry from platform-core"
```

---

### Task 2: Add error utilities (handleClientError, ErrorEvent)

**Files:**
- Create: `libs/event-processor/src/platform/errors.ts`

- [ ] **Step 1: Create errors.ts**

This module adds `handleClientError` and `ErrorEvent` — the things platform-core had that event-processor's `internal/errors.ts` doesn't. Import `NotRetryableError` and `isRetryable` from `../internal`:

```typescript
// libs/event-processor/src/platform/errors.ts
import { NotRetryableError, isRetryable } from '../internal';

// Re-export from internal for convenience
export { NotRetryableError, isRetryable };

/**
 * Shape of an AWS SDK ServiceException (duck-typed to avoid import coupling).
 */
interface AwsSdkError extends Error {
  $fault?: string;
  $retryable?: { throttling?: boolean };
}

/**
 * Converts non-retryable AWS client errors to NotRetryableError.
 * Re-throws retryable errors so the Lambda runtime retries them.
 */
export function handleClientError(error: unknown): never {
  if (!isRetryable(error)) {
    const err = error as AwsSdkError;
    throw new NotRetryableError(err.message, {
      name: err.name,
      fault: err.$fault,
    });
  }
  throw error;
}

export type ErrorEvent = {
  id: string;
  type: string;
  timestamp: string;
  error: {
    name: string;
    message: string;
    details?: Record<string, unknown>;
  };
};
```

- [ ] **Step 2: Commit**

```bash
git add libs/event-processor/src/platform/errors.ts
git commit -m "feat(event-processor): add handleClientError and ErrorEvent from platform-core"
```

---

### Task 3: Add bus module (BusEvent, Bus, EventBridgeBus)

**Files:**
- Create: `libs/event-processor/src/platform/bus.ts`

- [ ] **Step 1: Create bus.ts**

Copy `libs/platform-core/src/bus.ts` but update imports to use local modules (drop the `@log()` decorator — replaced by `withMethodLogging` HOF pattern across the codebase):

```typescript
// libs/event-processor/src/platform/bus.ts
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { type Event } from './core';
import { type ErrorEvent, NotRetryableError } from './errors';

/**
 * BusEvent — domain event published to EventBridge.
 */
export type BusEvent<T = object, S = Record<string, unknown>> = Event & {
  subject: T;
  context: S;
};

/**
 * Bus interface — publishes events to an event bus.
 */
export interface Bus {
  publish(event: BusEvent | ErrorEvent): Promise<void>;
}

/**
 * EventBridgeBus — publishes events to AWS EventBridge.
 * Source format: "{busName}@{serviceName}"
 */
export class EventBridgeBus implements Bus {
  private readonly client: EventBridgeClient;

  constructor(
    private readonly busName: string,
    private readonly serviceName: string,
  ) {
    this.client = new EventBridgeClient({});
  }

  async publish(event: BusEvent | ErrorEvent): Promise<void> {
    const detail = JSON.stringify(event);
    const detailSizeBytes = Buffer.byteLength(detail, 'utf-8');
    const MAX_EVENT_SIZE = 256 * 1024;
    if (detailSizeBytes > MAX_EVENT_SIZE) {
      throw new NotRetryableError(
        `Event exceeds EventBridge 256KB size limit: ${detailSizeBytes} bytes (type=${event.type}, id=${event.id})`,
        { eventType: event.type, eventId: event.id, sizeBytes: detailSizeBytes },
      );
    }

    const result = await this.client.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: this.busName,
            Source: `${this.busName}@${this.serviceName}`,
            DetailType: event.type,
            Detail: detail,
          },
        ],
      }),
    );

    if (result.FailedEntryCount && result.FailedEntryCount > 0) {
      const failedEntries = (result.Entries ?? []).filter(
        (e: { ErrorCode?: string }) => !!e.ErrorCode,
      );

      for (const entry of failedEntries) {
        // eslint-disable-next-line no-console
        console.error('EventBridge publish failed entry', {
          errorCode: entry.ErrorCode,
          errorMessage: entry.ErrorMessage,
          eventType: event.type,
          eventId: event.id,
        });
      }

      const firstFailed = failedEntries[0];
      const errorCode = firstFailed?.ErrorCode ?? 'UnknownError';
      const errorMessage = firstFailed?.ErrorMessage ?? 'unknown error';

      const RETRYABLE_CODES = ['ThrottlingException', 'InternalException'];
      if (RETRYABLE_CODES.includes(errorCode)) {
        throw new Error(
          `EventBridge publish failed (retryable): ${errorMessage}`,
        );
      }

      throw new NotRetryableError(
        `EventBridge publish failed: ${errorMessage}`,
        {
          errorCode,
          eventType: event.type,
          eventId: event.id,
          failedEntryCount: failedEntries.length,
        },
      );
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add libs/event-processor/src/platform/bus.ts
git commit -m "feat(event-processor): add BusEvent, Bus, EventBridgeBus from platform-core"
```

---

### Task 4: Add log decorator + validation

**Files:**
- Create: `libs/event-processor/src/platform/logger.ts`
- Create: `libs/event-processor/src/platform/validation.ts`

- [ ] **Step 1: Create logger.ts (log decorator)**

The `logger` singleton already exists in `internal/logger.ts`. This module adds the `@log()` decorator that platform-core provided:

```typescript
// libs/event-processor/src/platform/logger.ts
import { logger } from '../internal';

// Re-export the singleton
export { logger };

interface LogOptions {
  excludeArguments?: boolean;
  excludeResult?: boolean;
}

/**
 * Method decorator that logs method entry (with arguments) and exit (with result).
 */
export function log(options?: LogOptions) {
  return function (_target: unknown, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = function (...args: unknown[]) {
      const className = this?.constructor?.name ?? 'Unknown';
      const methodName = `${className}.${propertyKey}`;

      const logArgs = options?.excludeArguments ? '[redacted]' : flattenArgs(args);
      logger.info(`${methodName} called`, { method: methodName, arguments: logArgs });

      try {
        const result = originalMethod.apply(this, args);

        if (result instanceof Promise) {
          return result
            .then((resolved: unknown) => {
              const logResult = options?.excludeResult ? '[redacted]' : resolved;
              logger.info(`${methodName} returned`, { method: methodName, result: logResult });
              return resolved;
            })
            .catch((error: unknown) => {
              logger.error(`${methodName} threw`, {
                method: methodName,
                error: flattenError(error),
              });
              throw error;
            });
        }

        const logResult = options?.excludeResult ? '[redacted]' : result;
        logger.info(`${methodName} returned`, { method: methodName, result: logResult });
        return result;
      } catch (error) {
        logger.error(`${methodName} threw`, {
          method: methodName,
          error: flattenError(error),
        });
        throw error;
      }
    };

    return descriptor;
  };
}

function flattenArgs(args: unknown[]): unknown {
  return args.map((arg) => (arg instanceof Error ? flattenError(arg) : arg));
}

function flattenError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}
```

- [ ] **Step 2: Create validation.ts**

Copy `libs/platform-core/src/validation.ts` but import from local modules:

```typescript
// libs/event-processor/src/platform/validation.ts
import { ZodSchema, type ZodError } from 'zod';
import { type BusEvent } from './bus';
import { logger } from '../internal';

export interface ValidationResult<T> {
  valid: boolean;
  data?: T;
  error?: ZodError;
}

/**
 * Validates an incoming event against the producer's exported Zod schema.
 */
export function validateIncomingEvent<T>(
  event: BusEvent,
  schema: ZodSchema<T>,
): ValidationResult<T> {
  const result = schema.safeParse(event);
  if (result.success) {
    return { valid: true, data: result.data };
  }
  logger.error('Consumer-side schema validation failed', {
    eventType: event.type,
    eventId: event.id,
    errors: result.error.issues,
  });
  return { valid: false, error: result.error };
}
```

- [ ] **Step 3: Commit**

```bash
git add libs/event-processor/src/platform/logger.ts libs/event-processor/src/platform/validation.ts
git commit -m "feat(event-processor): add log decorator and validateIncomingEvent from platform-core"
```

---

### Task 5: Add FP utilities (pipe, Result)

**Files:**
- Create: `libs/event-processor/src/platform/fp/pipe.ts`
- Create: `libs/event-processor/src/platform/fp/result.ts`

- [ ] **Step 1: Create pipe.ts**

Copy `libs/platform-core/src/fp/pipe.ts` verbatim.

- [ ] **Step 2: Create result.ts**

Copy `libs/platform-core/src/fp/result.ts` verbatim.

- [ ] **Step 3: Commit**

```bash
git add libs/event-processor/src/platform/fp/
git commit -m "feat(event-processor): add FP utilities (pipe, Result) from platform-core"
```

---

### Task 6: Add branded types

**Files:**
- Create: `libs/event-processor/src/platform/types/branded.ts`

- [ ] **Step 1: Create branded.ts**

Copy `libs/platform-core/src/types/branded.ts` verbatim.

- [ ] **Step 2: Commit**

```bash
git add libs/event-processor/src/platform/types/branded.ts
git commit -m "feat(event-processor): add branded types from platform-core"
```

---

### Task 7: Add repositories (TableRepository, EventRepository, BucketRepository)

**Files:**
- Create: `libs/event-processor/src/platform/repositories/table.repository.ts`
- Create: `libs/event-processor/src/platform/repositories/event.repository.ts`
- Create: `libs/event-processor/src/platform/repositories/bucket.repository.ts`

- [ ] **Step 1: Create table.repository.ts**

Copy `libs/platform-core/src/repositories/table.repository.ts` but change the `log` import:

```typescript
// Change:
import { log } from '../logger';
// To:
import { log } from '../logger';
```

The relative path stays the same since we're mirroring the directory structure under `platform/`.

- [ ] **Step 2: Create event.repository.ts**

Copy `libs/platform-core/src/repositories/event.repository.ts` verbatim (no internal imports).

- [ ] **Step 3: Create bucket.repository.ts**

Copy `libs/platform-core/src/repositories/bucket.repository.ts` verbatim (no internal imports).

- [ ] **Step 4: Commit**

```bash
git add libs/event-processor/src/platform/repositories/
git commit -m "feat(event-processor): add repository base classes from platform-core"
```

---

### Task 8: Add market-data module

**Files:**
- Create: `libs/event-processor/src/platform/market-data/market-data-client.ts`
- Create: `libs/event-processor/src/platform/market-data/cached-market-data.ts`
- Create: `libs/event-processor/src/platform/market-data/index.ts`

- [ ] **Step 1: Create all three files**

Copy the three files from `libs/platform-core/src/market-data/` verbatim. They have no imports from other platform-core modules.

- [ ] **Step 2: Commit**

```bash
git add libs/event-processor/src/platform/market-data/
git commit -m "feat(event-processor): add market-data module from platform-core"
```

---

### Task 9: Add platform barrel + wire into event-processor index

**Files:**
- Create: `libs/event-processor/src/platform/index.ts`
- Modify: `libs/event-processor/src/index.ts`

- [ ] **Step 1: Create platform barrel**

```typescript
// libs/event-processor/src/platform/index.ts

// Core types
export { type Event, type Pipe, type UnitOfWork, envVar, getTime, getUUID } from './core';
export { type TableEntry } from './table';

// Bus
export { type BusEvent, type Bus, EventBridgeBus } from './bus';

// Errors (consolidates internal + platform)
export { NotRetryableError, isRetryable, handleClientError, type ErrorEvent } from './errors';

// Logger
export { log, logger } from './logger';

// Tracer (from internal)
export { tracer } from '../internal';

// Validation
export { validateIncomingEvent, type ValidationResult } from './validation';

// FP
export { pipe } from './fp/pipe';
export { type Result, ok, err, isOk, isErr, mapResult, flatMapResult, tryCatch } from './fp/result';

// Branded types
export { type TenantId, type UserId, type EventId, asTenantId, asUserId, asEventId } from './types/branded';

// Repositories
export { TableRepository } from './repositories/table.repository';
export { EventRepository } from './repositories/event.repository';
export { BucketRepository } from './repositories/bucket.repository';

// Market data
export {
  type Quote, type IndexData, type RateData, type MarketDataProvider,
  StaticMarketDataProvider, CachedMarketDataProvider, KNOWN_SYMBOLS,
} from './market-data';
```

- [ ] **Step 2: Add platform exports to event-processor barrel**

Append to `libs/event-processor/src/index.ts`:

```typescript
// Platform (from platform-core)
export {
  type Event, type Pipe, type UnitOfWork, envVar, getTime, getUUID,
  type TableEntry,
  type BusEvent, type Bus, EventBridgeBus,
  NotRetryableError, isRetryable, handleClientError, type ErrorEvent,
  log, logger, tracer,
  validateIncomingEvent, type ValidationResult,
  pipe,
  type Result, ok, err, isOk, isErr, mapResult, flatMapResult, tryCatch,
  type TenantId, type UserId, type EventId, asTenantId, asUserId, asEventId,
  TableRepository, EventRepository, BucketRepository,
  type Quote, type IndexData, type RateData, type MarketDataProvider,
  StaticMarketDataProvider, CachedMarketDataProvider, KNOWN_SYMBOLS,
} from './platform';
```

- [ ] **Step 3: Run event-processor tests**

Run: `npx nx test event-processor`
Expected: ALL PASS (existing tests unchanged)

- [ ] **Step 4: Commit**

```bash
git add libs/event-processor/src/platform/index.ts libs/event-processor/src/index.ts
git commit -m "feat(event-processor): export platform modules from barrel"
```

---

## Chunk 2: Expand event-processor — lambda modules

### Task 10: Add lambda utilities (requireEnv, auth, metrics, container, query-depth)

**Files:**
- Create: `libs/event-processor/src/lambda/require-env.ts`
- Create: `libs/event-processor/src/lambda/authorize-tenant.ts`
- Create: `libs/event-processor/src/lambda/validate-query-depth.ts`
- Create: `libs/event-processor/src/lambda/container.ts`
- Create: `libs/event-processor/src/lambda/service-metrics.ts`
- Create: `libs/event-processor/src/lambda/publish-error-event.ts`

- [ ] **Step 1: Create require-env.ts**

```typescript
// libs/event-processor/src/lambda/require-env.ts
import { NotRetryableError } from '../internal';

/**
 * Reads a required environment variable. Throws NotRetryableError if missing.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new NotRetryableError(
      `Missing required environment variable: ${name}`,
      { envVar: name },
    );
  }
  return value;
}
```

- [ ] **Step 2: Create authorize-tenant.ts**

Copy `libs/lambda-utils/src/authorize-tenant.ts` but change the import:

```typescript
// Change:
import { NotRetryableError } from '@nestfolio/platform-core';
// To:
import { NotRetryableError } from '../internal';
```

Keep rest verbatim.

- [ ] **Step 3: Create validate-query-depth.ts**

Copy `libs/lambda-utils/src/validate-query-depth.ts` verbatim (no external imports).

- [ ] **Step 4: Create container.ts**

Copy `libs/lambda-utils/src/container.ts` verbatim (only imports from awilix).

- [ ] **Step 5: Create service-metrics.ts**

Copy `libs/lambda-utils/src/service-metrics.ts` verbatim (only imports from @aws-lambda-powertools/metrics).

- [ ] **Step 6: Create publish-error-event.ts**

Copy `libs/lambda-utils/src/publish-error-event.ts` but update imports:

```typescript
// libs/event-processor/src/lambda/publish-error-event.ts
import { NotRetryableError, logger } from '../internal';
import { getUUID, getTime } from '../platform/core';
import type { Bus } from '../platform/bus';
import type { ErrorEvent } from '../platform/errors';
```

Keep rest of the function verbatim.

- [ ] **Step 7: Commit**

```bash
git add libs/event-processor/src/lambda/require-env.ts \
  libs/event-processor/src/lambda/authorize-tenant.ts \
  libs/event-processor/src/lambda/validate-query-depth.ts \
  libs/event-processor/src/lambda/container.ts \
  libs/event-processor/src/lambda/service-metrics.ts \
  libs/event-processor/src/lambda/publish-error-event.ts
git commit -m "feat(event-processor): add lambda utilities from lambda-utils"
```

---

### Task 11: Add middleware (withErrorPublishing, withMethodLogging)

**Files:**
- Create: `libs/event-processor/src/lambda/middleware/with-error-publishing.ts`
- Create: `libs/event-processor/src/lambda/middleware/with-method-logging.ts`

- [ ] **Step 1: Create with-error-publishing.ts**

```typescript
// libs/event-processor/src/lambda/middleware/with-error-publishing.ts
import type { Bus } from '../../platform/bus';
import type { Middleware } from '../../internal';
import { publishErrorEvent } from '../publish-error-event';

/**
 * Middleware that publishes non-retryable errors to EventBridge.
 */
export const withErrorPublishing = (bus: Bus, errorEventType: string): Middleware =>
  (fn) =>
    async (...args: unknown[]) => {
      try {
        return await fn(...args);
      } catch (error) {
        await publishErrorEvent(bus, errorEventType, error);
        throw error;
      }
    };
```

- [ ] **Step 2: Create with-method-logging.ts**

```typescript
// libs/event-processor/src/lambda/middleware/with-method-logging.ts
import { logger } from '../../internal';

/**
 * Wraps async methods with entry/exit logging.
 */
export const withMethodLogging = (className: string) =>
  <A extends unknown[], R>(
    methodName: string,
    fn: (...args: A) => Promise<R>,
  ): ((...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      logger.debug(`${className}.${methodName} called`, { args: summarizeArgs(args) });
      try {
        const result = await fn(...args);
        logger.debug(`${className}.${methodName} completed`);
        return result;
      } catch (error) {
        logger.error(`${className}.${methodName} failed`, {
          error: error instanceof Error
            ? { name: error.name, message: error.message }
            : { message: String(error) },
        });
        throw error;
      }
    };

function summarizeArgs(args: unknown[]): unknown[] {
  return args.map((arg) => {
    if (typeof arg === 'string' && arg.length > 100) return arg.slice(0, 100) + '...';
    if (typeof arg === 'object' && arg !== null) return '[object]';
    return arg;
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add libs/event-processor/src/lambda/middleware/
git commit -m "feat(event-processor): add withErrorPublishing and withMethodLogging from lambda-utils"
```

---

### Task 12: Add event-publisher handler + test utilities

**Files:**
- Create: `libs/event-processor/src/lambda/event-publisher.ts`
- Create: `libs/event-processor/src/lambda/test-utils/evaluate-resolver.ts`

- [ ] **Step 1: Create event-publisher.ts**

Copy `libs/lambda-utils/src/event-publisher.ts` but update the import:

```typescript
// Change:
import { logger, getUUID, getTime, NotRetryableError } from '@nestfolio/platform-core';
// To:
import { logger, NotRetryableError } from '../internal';
import { getUUID, getTime } from '../platform/core';
```

Keep rest verbatim.

- [ ] **Step 2: Create evaluate-resolver.ts**

Copy `libs/lambda-utils/src/test-utils/evaluate-resolver.ts` verbatim (no platform-core imports).

- [ ] **Step 3: Commit**

```bash
git add libs/event-processor/src/lambda/event-publisher.ts \
  libs/event-processor/src/lambda/test-utils/evaluate-resolver.ts
git commit -m "feat(event-processor): add event-publisher handler and test-utils from lambda-utils"
```

---

### Task 13: Add lambda barrel + wire into event-processor index

**Files:**
- Create: `libs/event-processor/src/lambda/index.ts`
- Modify: `libs/event-processor/src/index.ts`

- [ ] **Step 1: Create lambda barrel**

```typescript
// libs/event-processor/src/lambda/index.ts
import { join } from 'path';

/** Absolute path to the event-publisher Lambda entry point (for CDK Egress construct) */
export const EVENT_PUBLISHER_ENTRY = join(__dirname, 'event-publisher.ts');

export { requireEnv } from './require-env';
export { authorizeTenant, authorizeUser, type AuthorizedIdentity } from './authorize-tenant';
export { validateQueryDepth } from './validate-query-depth';
export { buildContainer } from './container';
export { createServiceMetrics, MetricUnit } from './service-metrics';
export { publishErrorEvent } from './publish-error-event';

// Middleware
export { withErrorPublishing } from './middleware/with-error-publishing';
export { withMethodLogging } from './middleware/with-method-logging';

// Re-export internal middleware + utilities (already in event-processor's internal/)
export { applyMiddleware, withLambdaContext, withTiming } from '../internal';
export type { Middleware } from '../internal';
export { parseRecord } from '../internal';
export { guardedWrite } from '../internal';
export { extractTenantId } from '../internal';
export { traceEvent } from '../internal';

// Test utilities
export { evaluateResolver, createAuthContext } from './test-utils/evaluate-resolver';
export type { EvalContext } from './test-utils/evaluate-resolver';
```

- [ ] **Step 2: Add lambda exports to event-processor barrel**

Append to `libs/event-processor/src/index.ts`:

```typescript
// Lambda utilities (from lambda-utils)
export {
  EVENT_PUBLISHER_ENTRY,
  requireEnv,
  authorizeTenant, authorizeUser, type AuthorizedIdentity,
  validateQueryDepth,
  buildContainer,
  createServiceMetrics, MetricUnit,
  publishErrorEvent,
  withErrorPublishing,
  withMethodLogging,
  applyMiddleware, withLambdaContext, withTiming,
  type Middleware,
  parseRecord, guardedWrite, extractTenantId, traceEvent,
  evaluateResolver, createAuthContext, type EvalContext,
} from './lambda';
```

- [ ] **Step 3: Run event-processor tests**

Run: `npx nx test event-processor`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add libs/event-processor/src/lambda/index.ts libs/event-processor/src/index.ts
git commit -m "feat(event-processor): export lambda utilities from barrel"
```

---

## Chunk 3: Add domain infrastructure to event-processor

### Task 14: Create domain errors in event-processor

**Files:**
- Create: `libs/event-processor/src/domain/errors.ts`
- Create: `libs/event-processor/test/domain/errors.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// libs/event-processor/test/domain/errors.test.ts
import {
  DomainError,
  DomainValidationError,
  EntityNotFoundError,
  BusinessRuleViolationError,
  TenantAccessDeniedError,
} from '../../src/domain/errors';

describe('DomainError', () => {
  it('should set name, message, and code', () => {
    const err = new DomainError('msg', 'CODE');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('DomainError');
    expect(err.message).toBe('msg');
    expect(err.code).toBe('CODE');
  });
});

describe('DomainValidationError', () => {
  it('should include validation details', () => {
    const details = [{ path: '/name', message: 'required' }];
    const err = new DomainValidationError('invalid', details);
    expect(err).toBeInstanceOf(DomainError);
    expect(err.code).toBe('DOMAIN_VALIDATION_ERROR');
    expect(err.details).toEqual(details);
  });
});

describe('EntityNotFoundError', () => {
  it('should format entity type and id', () => {
    const err = new EntityNotFoundError('Order', '123');
    expect(err).toBeInstanceOf(DomainError);
    expect(err.code).toBe('ENTITY_NOT_FOUND');
    expect(err.entityType).toBe('Order');
    expect(err.entityId).toBe('123');
    expect(err.message).toBe("Order with id '123' not found");
  });
});

describe('BusinessRuleViolationError', () => {
  it('should include rule name', () => {
    const err = new BusinessRuleViolationError('MAX_TRADE', 'too large');
    expect(err).toBeInstanceOf(DomainError);
    expect(err.code).toBe('BUSINESS_RULE_VIOLATION');
    expect(err.rule).toBe('MAX_TRADE');
  });
});

describe('TenantAccessDeniedError', () => {
  it('should include tenant and resource', () => {
    const err = new TenantAccessDeniedError('t-1', 'Order:123');
    expect(err).toBeInstanceOf(DomainError);
    expect(err.code).toBe('TENANT_ACCESS_DENIED');
    expect(err.message).toContain('t-1');
    expect(err.message).toContain('Order:123');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx nx test event-processor -- --testPathPattern=domain/errors`
Expected: FAIL

- [ ] **Step 3: Create the errors module**

Copy `libs/domain-core/src/shared/errors.ts` verbatim to `libs/event-processor/src/domain/errors.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx nx test event-processor -- --testPathPattern=domain/errors`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add libs/event-processor/src/domain/errors.ts libs/event-processor/test/domain/errors.test.ts
git commit -m "feat(event-processor): add domain error classes from domain-core"
```

---

### Task 15: Create domain schemas in event-processor

**Files:**
- Create: `libs/event-processor/src/domain/schemas.ts`
- Create: `libs/event-processor/test/domain/schemas.test.ts`

- [ ] **Step 1: Write the failing tests**

Copy `libs/domain-core/test/shared/types.test.ts` to `libs/event-processor/test/domain/schemas.test.ts`, updating the import to `../../src/domain/schemas`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx nx test event-processor -- --testPathPattern=domain/schemas`
Expected: FAIL

- [ ] **Step 3: Create the schemas module**

Copy `libs/domain-core/src/shared/types.ts` verbatim to `libs/event-processor/src/domain/schemas.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx nx test event-processor -- --testPathPattern=domain/schemas`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add libs/event-processor/src/domain/schemas.ts libs/event-processor/test/domain/schemas.test.ts
git commit -m "feat(event-processor): add bus event schemas from domain-core"
```

---

### Task 16: Wire domain barrel + update event-processor index

**Files:**
- Create: `libs/event-processor/src/domain/index.ts`
- Modify: `libs/event-processor/src/index.ts`

- [ ] **Step 1: Create domain barrel**

```typescript
// libs/event-processor/src/domain/index.ts
export {
  DomainError,
  DomainValidationError,
  EntityNotFoundError,
  BusinessRuleViolationError,
  TenantAccessDeniedError,
} from './errors';

export {
  BusEventSchema,
  TenantContextSchema,
  EditEventSchema,
  EditOperationSchema,
} from './schemas';

export type {
  BusEvent as BusEventType,
  TenantContext,
  EditEvent,
  EditOperation,
} from './schemas';
```

Note: `BusEvent` from schemas is the Zod-inferred type. Export it as `BusEventType` to avoid collision with the `BusEvent` generic type from `platform/bus.ts`. If the existing codebase uses `BusEvent` from domain-core as a type and `BusEvent` from platform-core as the generic type, keep both — the domain Zod type is used for schema validation, the platform generic type is used for bus publishing.

- [ ] **Step 2: Add domain exports to event-processor barrel**

Append to `libs/event-processor/src/index.ts`:

```typescript
// Domain (shared infrastructure types & errors)
export {
  DomainError,
  DomainValidationError,
  EntityNotFoundError,
  BusinessRuleViolationError,
  TenantAccessDeniedError,
  BusEventSchema,
  TenantContextSchema,
  EditEventSchema,
  EditOperationSchema,
} from './domain';
export type {
  BusEventType,
  TenantContext,
  EditEvent,
  EditOperation,
} from './domain';
```

- [ ] **Step 3: Run full event-processor test suite**

Run: `npx nx test event-processor`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add libs/event-processor/src/domain/index.ts libs/event-processor/src/index.ts
git commit -m "feat(event-processor): export domain types from barrel"
```

---

## Chunk 4: Distribute events, schemas, and models to publishing services

Each publishing service gets a `src/domain/` folder with `events.ts` (+ optional `schemas.ts`, `models.ts`) and an `index.ts` barrel. Consumers import event type constants from the producer via tsconfig aliases.

### Task 17: investor-bff — events, schemas, models, barrel

**Files:**
- Create: `services/investor/investor-bff/src/domain/events.ts`
- Create: `services/investor/investor-bff/src/domain/schemas.ts`
- Create: `services/investor/investor-bff/src/domain/models.ts`
- Create: `services/investor/investor-bff/src/domain/index.ts`

- [ ] **Step 1: Create events.ts**

```typescript
// services/investor/investor-bff/src/domain/events.ts
export const InvestorBffEventTypes = {
  USER_REGISTERED: 'USER_REGISTERED',
  USER_AUTHENTICATED: 'USER_AUTHENTICATED',
  USER_SESSION_EXPIRED: 'USER_SESSION_EXPIRED',
  USER_DELETION_REQUESTED: 'USER_DELETION_REQUESTED',
  PII_REMOVED: 'PII_REMOVED',
  TENANT_ANONYMIZED: 'TENANT_ANONYMIZED',
  ONBOARDING_ANSWER_RECORDED: 'ONBOARDING_ANSWER_RECORDED',
  ONBOARDING_COMPLETED: 'ONBOARDING_COMPLETED',
  GOAL_SET: 'GOAL_SET',
  GOAL_UPDATED: 'GOAL_UPDATED',
  RISK_PROFILE_SET: 'RISK_PROFILE_SET',
  RISK_PROFILE_UPDATED: 'RISK_PROFILE_UPDATED',
  MANDATE_GRANTED: 'MANDATE_GRANTED',
  MANDATE_UPDATED: 'MANDATE_UPDATED',
  MANDATE_REVOKED: 'MANDATE_REVOKED',
  OPERATING_MODE_SELECTED: 'OPERATING_MODE_SELECTED',
  OPERATING_MODE_CHANGED: 'OPERATING_MODE_CHANGED',
  DEPOSIT_INITIATED: 'DEPOSIT_INITIATED',
  WITHDRAWAL_REQUESTED: 'WITHDRAWAL_REQUESTED',
  ACCOUNT_CLOSURE_REQUESTED: 'ACCOUNT_CLOSURE_REQUESTED',
  ACCOUNT_CLOSED: 'ACCOUNT_CLOSED',
  BROKER_AUTHORIZATION_REVOKED: 'BROKER_AUTHORIZATION_REVOKED',
  NOTIFICATION_READ: 'NOTIFICATION_READ',
} as const;

export type InvestorBffEventType =
  (typeof InvestorBffEventTypes)[keyof typeof InvestorBffEventTypes];
```

- [ ] **Step 2: Create schemas.ts**

Copy `libs/domain-core/src/investor/schemas.ts` but change the import:
```typescript
// OLD: import { BusEventSchema } from '../shared/types';
// NEW:
import { BusEventSchema } from '@nestfolio/event-processor';
```

- [ ] **Step 3: Create models.ts**

Copy `libs/domain-core/src/investor/models.ts` verbatim.

- [ ] **Step 4: Create barrel index.ts**

```typescript
// services/investor/investor-bff/src/domain/index.ts
export { InvestorBffEventTypes } from './events';
export type { InvestorBffEventType } from './events';

export {
  MandateGrantedSchema, GoalUpdatedSchema, RiskProfileUpdatedSchema,
  OnboardingCompletedSchema, DepositInitiatedSchema,
} from './schemas';
export type {
  MandateGrantedEvent, GoalUpdatedEvent, RiskProfileUpdatedEvent,
  OnboardingCompletedEvent, DepositInitiatedEvent,
} from './schemas';

export type {
  InvestorProfile, Goal, RiskProfile, Mandate,
  OperatingMode, MandateLevel, RebalanceCadence,
  Notification, NotificationChannel, NotificationStatus,
} from './models';
```

- [ ] **Step 5: Commit**

```bash
git add services/investor/investor-bff/src/domain/
git commit -m "feat(investor-bff): add domain events, schemas, and models (from domain-core)"
```

---

### Task 18: investor-ctrl — events + barrel

- [ ] **Step 1: Create `services/investor/investor-ctrl/src/domain/events.ts`**

```typescript
export const InvestorCtrlEventTypes = {
  NOTIFICATION_CREATED: 'NOTIFICATION_CREATED',
  NOTIFICATION_SENT: 'NOTIFICATION_SENT',
  NOTIFICATION_DELIVERED: 'NOTIFICATION_DELIVERED',
  MONTHLY_REPORT_GENERATED: 'MONTHLY_REPORT_GENERATED',
} as const;

export type InvestorCtrlEventType =
  (typeof InvestorCtrlEventTypes)[keyof typeof InvestorCtrlEventTypes];
```

- [ ] **Step 2: Create `services/investor/investor-ctrl/src/domain/index.ts`**

```typescript
export { InvestorCtrlEventTypes } from './events';
export type { InvestorCtrlEventType } from './events';
```

- [ ] **Step 3: Commit**

```bash
git add services/investor/investor-ctrl/src/domain/
git commit -m "feat(investor-ctrl): add domain events (from domain-core)"
```

---

### Task 19: advisory-ctrl — events, schemas, models, barrel

- [ ] **Step 1: Create `services/advisory/advisory-ctrl/src/domain/events.ts`** with `AdvisoryCtrlEventTypes` (all 33 events from the Publisher map above)

- [ ] **Step 2: Create `services/advisory/advisory-ctrl/src/domain/schemas.ts`**

```typescript
import { z } from 'zod';
import { BusEventSchema } from '@nestfolio/event-processor';

export const DecisionPacketCreatedSchema = BusEventSchema.extend({
  type: z.literal('DECISION_PACKET_CREATED'),
  subject: z.object({
    decisionId: z.string(),
    trigger: z.string(),
    tenantId: z.string().uuid(),
  }),
});
export type DecisionPacketCreatedEvent = z.infer<typeof DecisionPacketCreatedSchema>;

export const UserConfirmationRequestedSchema = BusEventSchema.extend({
  type: z.literal('USER_CONFIRMATION_REQUESTED'),
  subject: z.object({
    decisionId: z.string(),
    tenantId: z.string().uuid(),
    summary: z.string(),
    expiresAt: z.string().datetime(),
  }),
});
export type UserConfirmationRequestedEvent = z.infer<typeof UserConfirmationRequestedSchema>;
```

- [ ] **Step 3: Create `services/advisory/advisory-ctrl/src/domain/models.ts`** — copy `libs/domain-core/src/advisory/models.ts` verbatim

- [ ] **Step 4: Create `services/advisory/advisory-ctrl/src/domain/index.ts`**

```typescript
export { AdvisoryCtrlEventTypes } from './events';
export type { AdvisoryCtrlEventType } from './events';
export { DecisionPacketCreatedSchema, UserConfirmationRequestedSchema } from './schemas';
export type { DecisionPacketCreatedEvent, UserConfirmationRequestedEvent } from './schemas';
export type {
  DecisionPacket, ProposedTrade, ComplianceCheck, AgentInvocation,
  DecisionStatus, ComplianceLevel, ComplianceResult,
} from './models';
```

- [ ] **Step 5: Commit**

```bash
git add services/advisory/advisory-ctrl/src/domain/
git commit -m "feat(advisory-ctrl): add domain events, schemas, and models (from domain-core)"
```

---

### Task 20: advisory-bff — events + barrel

- [ ] **Step 1: Create `services/advisory/advisory-bff/src/domain/events.ts`** with `AdvisoryBffEventTypes` (USER_CONFIRMED, USER_REJECTED, USER_VIEWED_EXPLANATION)

- [ ] **Step 2: Create `services/advisory/advisory-bff/src/domain/index.ts`**

- [ ] **Step 3: Commit**

```bash
git add services/advisory/advisory-bff/src/domain/
git commit -m "feat(advisory-bff): add domain events (from domain-core)"
```

---

### Task 21: compliance-ctrl — events, schemas, barrel

- [ ] **Step 1: Create `services/advisory/compliance-ctrl/src/domain/events.ts`** with `ComplianceEventTypes` (8 events from map)

- [ ] **Step 2: Create `services/advisory/compliance-ctrl/src/domain/schemas.ts`** — DecisionApprovedSchema + DecisionBlockedSchema (import BusEventSchema from event-processor)

- [ ] **Step 3: Create `services/advisory/compliance-ctrl/src/domain/index.ts`**

- [ ] **Step 4: Commit**

```bash
git add services/advisory/compliance-ctrl/src/domain/
git commit -m "feat(compliance-ctrl): add domain events and schemas (from domain-core)"
```

---

### Task 22: execution-ctrl — events, schemas, models, barrel

- [ ] **Step 1: Create `services/execution/execution-ctrl/src/domain/events.ts`** with `ExecutionCtrlEventTypes` (4 events)

- [ ] **Step 2: Create `services/execution/execution-ctrl/src/domain/schemas.ts`** — OrderSubmittedSchema

- [ ] **Step 3: Create `services/execution/execution-ctrl/src/domain/models.ts`** — Order, Portfolio, Position, OrderStatus, OrderSide, OrderType (NOT Reconciliation — that belongs to reconciliation-ctrl)

- [ ] **Step 4: Create `services/execution/execution-ctrl/src/domain/index.ts`**

- [ ] **Step 5: Commit**

```bash
git add services/execution/execution-ctrl/src/domain/
git commit -m "feat(execution-ctrl): add domain events, schemas, and models (from domain-core)"
```

---

### Task 23: execution-adpt — events, schemas, barrel

- [ ] **Step 1: Create `services/execution/execution-adpt/src/domain/events.ts`** with `ExecutionAdptEventTypes` (15 events)

- [ ] **Step 2: Create `services/execution/execution-adpt/src/domain/schemas.ts`** — OrderFilledSchema + DepositDetectedSchema

- [ ] **Step 3: Create `services/execution/execution-adpt/src/domain/index.ts`**

- [ ] **Step 4: Commit**

```bash
git add services/execution/execution-adpt/src/domain/
git commit -m "feat(execution-adpt): add domain events and schemas (from domain-core)"
```

---

### Task 24: ledger-ctrl — events + barrel

- [ ] **Step 1: Create `services/ledger/ledger-ctrl/src/domain/events.ts`** with `LedgerCtrlEventTypes` (5 events)

- [ ] **Step 2: Create `services/ledger/ledger-ctrl/src/domain/index.ts`**

- [ ] **Step 3: Commit**

```bash
git add services/ledger/ledger-ctrl/src/domain/
git commit -m "feat(ledger-ctrl): add domain events (from domain-core)"
```

---

### Task 25: reconciliation-ctrl — events, schemas, models, barrel

- [ ] **Step 1: Create `services/ledger/reconciliation-ctrl/src/domain/events.ts`** with `ReconciliationEventTypes` (9 events)

- [ ] **Step 2: Create `services/ledger/reconciliation-ctrl/src/domain/schemas.ts`** — PortfolioDriftDetectedSchema

- [ ] **Step 3: Create `services/ledger/reconciliation-ctrl/src/domain/models.ts`** — Reconciliation, ReconciliationStatus

- [ ] **Step 4: Create `services/ledger/reconciliation-ctrl/src/domain/index.ts`**

- [ ] **Step 5: Commit**

```bash
git add services/ledger/reconciliation-ctrl/src/domain/
git commit -m "feat(reconciliation-ctrl): add domain events, schemas, and models (from domain-core)"
```

---

### Task 26: Run full test suite (Chunk 4 checkpoint)

- [ ] **Step 1: Run all tests**

Run: `npx nx run-many -t test --all`
Expected: ALL PASS (no imports changed yet — just new files added)

---

## Chunk 5: Add tsconfig aliases + rewire ALL source imports

### Task 27: Update tsconfig.base.json

**Files:**
- Modify: `tsconfig.base.json`

- [ ] **Step 1: Add service domain path aliases**

Add these entries to the `paths` object:

```json
"@nestfolio/investor-bff/domain": ["services/investor/investor-bff/src/domain/index.ts"],
"@nestfolio/investor-ctrl/domain": ["services/investor/investor-ctrl/src/domain/index.ts"],
"@nestfolio/advisory-ctrl/domain": ["services/advisory/advisory-ctrl/src/domain/index.ts"],
"@nestfolio/advisory-bff/domain": ["services/advisory/advisory-bff/src/domain/index.ts"],
"@nestfolio/compliance-ctrl/domain": ["services/advisory/compliance-ctrl/src/domain/index.ts"],
"@nestfolio/execution-ctrl/domain": ["services/execution/execution-ctrl/src/domain/index.ts"],
"@nestfolio/execution-adpt/domain": ["services/execution/execution-adpt/src/domain/index.ts"],
"@nestfolio/ledger-ctrl/domain": ["services/ledger/ledger-ctrl/src/domain/index.ts"],
"@nestfolio/reconciliation-ctrl/domain": ["services/ledger/reconciliation-ctrl/src/domain/index.ts"]
```

- [ ] **Step 2: Commit**

```bash
git add tsconfig.base.json
git commit -m "build: add tsconfig path aliases for service domain barrels"
```

---

### Task 28: Rewire source imports — @nestfolio/platform-core → @nestfolio/event-processor

Apply this transformation to ALL source files that import from `@nestfolio/platform-core`. The import names stay the same — only the module specifier changes.

**Rule:** `from '@nestfolio/platform-core'` → `from '@nestfolio/event-processor'`

**Exception:** For types that are now local to the service (models imported via `../domain/models`), use relative imports instead. Specifically:
- In `investor-bff/src/repositories/investor-profile.repository.ts`: `EntityNotFoundError` → from `@nestfolio/event-processor`, model types → from `../domain/models`
- In `advisory-ctrl/src/services/decision-lifecycle.service.ts`: `ProposedTrade` → from `../domain/models`
- In `compliance-ctrl/src/repositories/compliance.repository.ts`: `EntityNotFoundError` → from `@nestfolio/event-processor`
- In `compliance-ctrl/src/rules/rule-engine.ts`: `MandateLevel` → from `@nestfolio/investor-bff/domain`
- In `execution-ctrl/src/repositories/order.repository.ts`, `services/order-lifecycle.service.ts`, `services/safety-checks.service.ts`: `ProposedTrade` → from `@nestfolio/advisory-ctrl/domain`

**Files (~60):** All service source files listed in the grep results that import from `@nestfolio/platform-core`. Each file changes only the import specifier.

- [ ] **Step 1: Run search-and-replace**

For each file, change `from '@nestfolio/platform-core'` to `from '@nestfolio/event-processor'`, then handle the special cases above.

- [ ] **Step 2: Verify no remaining platform-core imports in source**

Run: `grep -r "@nestfolio/platform-core" --include="*.ts" services/*/src/ services/*/*/src/ libs/*/src/ apps/*/src/`
Expected: NO MATCHES (test files handled separately)

- [ ] **Step 3: Commit**

```bash
git add services/ libs/ apps/
git commit -m "refactor: replace @nestfolio/platform-core imports with @nestfolio/event-processor"
```

---

### Task 29: Rewire source imports — @nestfolio/lambda-utils → @nestfolio/event-processor

**Rule:** `from '@nestfolio/lambda-utils'` → `from '@nestfolio/event-processor'`

**Files (~36):** All service source files that import from `@nestfolio/lambda-utils`.

Also rewire:
- `libs/cdk-constructs/src/egress.ts`: `import { EVENT_PUBLISHER_ENTRY } from '@nestfolio/lambda-utils'` → `from '@nestfolio/event-processor'`

- [ ] **Step 1: Run search-and-replace**

For each file, change `from '@nestfolio/lambda-utils'` to `from '@nestfolio/event-processor'`.

- [ ] **Step 2: Verify no remaining lambda-utils imports in source**

Run: `grep -r "@nestfolio/lambda-utils" --include="*.ts" services/*/src/ services/*/*/src/ libs/*/src/ apps/*/src/`
Expected: NO MATCHES

- [ ] **Step 3: Commit**

```bash
git add services/ libs/
git commit -m "refactor: replace @nestfolio/lambda-utils imports with @nestfolio/event-processor"
```

---

### Task 30: Rewire source imports — @nestfolio/domain-core → service domains / event-processor

**Rule:** `from '@nestfolio/domain-core'` → appropriate target based on what's imported.

The files that import from `@nestfolio/domain-core`:

| File | Import | New Source |
|------|--------|-----------|
| `investor-bff/src/repositories/investor-profile.repository.ts` | `EntityNotFoundError` | `@nestfolio/event-processor` |
| `investor-bff/src/repositories/investor-profile.repository.ts` | model types (Goal, RiskProfile, Mandate, etc.) | `../domain/models` |
| `advisory-ctrl/src/services/decision-lifecycle.service.ts` | `ProposedTrade` | `../domain/models` |
| `compliance-ctrl/src/repositories/compliance.repository.ts` | `EntityNotFoundError` | `@nestfolio/event-processor` |
| `compliance-ctrl/src/rules/rule-engine.ts` | `MandateLevel` | `@nestfolio/investor-bff/domain` |
| `execution-ctrl/src/repositories/order.repository.ts` | `ProposedTrade` | `@nestfolio/advisory-ctrl/domain` |
| `execution-ctrl/src/services/order-lifecycle.service.ts` | `ProposedTrade` | `@nestfolio/advisory-ctrl/domain` |
| `execution-ctrl/src/services/safety-checks.service.ts` | `ProposedTrade` | `@nestfolio/advisory-ctrl/domain` |
| `apps/investor-mfe/src/app/services/onboarding.service.ts` | `Goal, Mandate, RiskProfile` | `@nestfolio/investor-bff/domain` |

- [ ] **Step 1: Apply all rewiring per the table above**

- [ ] **Step 2: Verify no remaining domain-core imports in source**

Run: `grep -r "@nestfolio/domain-core" --include="*.ts" services/*/src/ services/*/*/src/ libs/*/src/ apps/*/src/`
Expected: NO MATCHES

- [ ] **Step 3: Commit**

```bash
git add services/ apps/
git commit -m "refactor: replace @nestfolio/domain-core imports with service domain + event-processor"
```

---

### Task 31: Rewire command-core imports

**Files:**
- Modify: `libs/command-core/src/command.ts`

- [ ] **Step 1: Change import**

```typescript
// Change:
import { type Result, ok, err } from '@nestfolio/platform-core';
// To:
import { type Result, ok, err } from '@nestfolio/event-processor';
```

- [ ] **Step 2: Commit**

```bash
git add libs/command-core/src/command.ts
git commit -m "refactor(command-core): replace platform-core import with event-processor"
```

---

### Task 32: Rewire event-listener.ts files to use typed imports from producers

Replace string literals in each consumer's event-listener.ts with imported constants from the producer service. Follow the Consumer → Producer Import Map at the top of this plan.

**Files:** All 11 `event-listener.ts` files across services.

- [ ] **Step 1: investor-bff event-listener.ts** — add `InvestorBffEventTypes` (own), `InvestorCtrlEventTypes`, `LedgerCtrlEventTypes` imports; replace string literals

- [ ] **Step 2: investor-ctrl event-listener.ts** — add `InvestorBffEventTypes`, `ComplianceEventTypes`, `ExecutionAdptEventTypes`, `LedgerCtrlEventTypes`

- [ ] **Step 3: dashboard-bff event-listener.ts** — add `LedgerCtrlEventTypes`, `ReconciliationEventTypes`, `AdvisoryCtrlEventTypes`, `ComplianceEventTypes`, `InvestorBffEventTypes`; leave `INVESTOR_SNAPSHOT_UPDATED` as string literal

- [ ] **Step 4: advisory-ctrl event-listener.ts** — add `InvestorBffEventTypes`, `AdvisoryBffEventTypes`, `ComplianceEventTypes`, `ExecutionAdptEventTypes`, `ReconciliationEventTypes`

- [ ] **Step 5: advisory-bff event-listener.ts** — add `AdvisoryCtrlEventTypes`, `ComplianceEventTypes`

- [ ] **Step 6: compliance-ctrl event-listener.ts** — add `AdvisoryCtrlEventTypes`, `InvestorBffEventTypes`

- [ ] **Step 7: execution-ctrl event-listener.ts** — add `ComplianceEventTypes`, `AdvisoryBffEventTypes`, `AdvisoryCtrlEventTypes`, `InvestorBffEventTypes`

- [ ] **Step 8: execution-adpt event-listener.ts** — add `ExecutionCtrlEventTypes`, `InvestorBffEventTypes`

- [ ] **Step 9: ledger-ctrl event-listener.ts** — add `ExecutionAdptEventTypes`, `AdvisoryCtrlEventTypes`; leave `CORPORATE_ACTION_PROCESSED` as string literal

- [ ] **Step 10: ledger-bff event-listener.ts** — add `LedgerCtrlEventTypes`

- [ ] **Step 11: reconciliation-ctrl event-listener.ts** — add `LedgerCtrlEventTypes`, `ExecutionAdptEventTypes`; leave `CORPORATE_ACTION_APPLIED` as string literal

- [ ] **Step 12: Run full test suite**

Run: `npx nx run-many -t test --all`
Expected: ALL PASS

- [ ] **Step 13: Commit**

```bash
git add services/
git commit -m "refactor: replace event type string literals with typed imports from producer services"
```

---

## Chunk 6: Fix test mocks + jest configs + delete libraries

### Task 33: Retarget test mocks from old libs to @nestfolio/event-processor

Test files use `jest.mock` with **multi-line factory functions** that provide mock implementations of `TableRepository`, `logger`, `getUUID`, `withMethodLogging`, `EntityNotFoundError`, etc. Since all three libs are consolidated into event-processor, these mocks must be **merged into a single `jest.mock('@nestfolio/event-processor', ...)`** call per test file.

**Two mock patterns exist:**

**Pattern A — Repository tests** (complex, ~50-70 lines): provide mock `TableRepository` class, `getUUID`, `getTime`, `logger`, `NotRetryableError`, plus lambda-utils mocks (`withMethodLogging`), plus optional domain-core mocks (`EntityNotFoundError`).

**Pattern B — Pipe/listener tests** (simple, 2-4 lines): provide mock `logger`, `log` decorator, and `requireEnv`.

**Transformation rule for each test file:**

1. Collect all mock factory objects from `jest.mock('@nestfolio/platform-core', ...)`, `jest.mock('@nestfolio/lambda-utils', ...)`, and `jest.mock('@nestfolio/domain-core', ...)`.
2. Merge them into a single mock:

```typescript
jest.mock('@nestfolio/event-processor', () => {
  const actual = jest.requireActual('@nestfolio/event-processor');
  return {
    ...actual,
    // --- from old platform-core mock ---
    TableRepository: class { /* same mock body */ },
    getUUID: jest.fn().mockReturnValue('test-uuid'),
    getTime: jest.fn().mockReturnValue('2025-01-01T00:00:00.000Z'),
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
    NotRetryableError: class NotRetryableError extends Error { /* same */ },
    // --- from old lambda-utils mock ---
    withMethodLogging: jest.fn((_cn: string) => (_mn: string, fn: Function) => fn),
    // --- from old domain-core mock (if present) ---
    EntityNotFoundError: class EntityNotFoundError extends Error { /* same */ },
  };
});
```

3. Delete the 3 individual `jest.mock(...)` blocks.
4. Update any `import ... from '@nestfolio/platform-core'` in test files to `from '@nestfolio/event-processor'`.
5. Update any `import ... from '@nestfolio/domain-core'` in test files similarly.

**Files:** ~53 test files mock platform-core, ~47 mock lambda-utils, ~24 mock domain-core (many overlap — same file mocks multiple libs).

- [ ] **Step 1: Transform all test files using the rule above**

Process service by service, following the two patterns. For pipe/listener tests (Pattern B), the merged mock is short. For repository tests (Pattern A), copy the existing mock body and add lambda-utils/domain-core overrides.

- [ ] **Step 2: Verify no remaining references**

Run: `grep -r "@nestfolio/platform-core\|@nestfolio/lambda-utils\|@nestfolio/domain-core" --include="*.ts" services/ libs/ apps/`
Expected: NO MATCHES (jest.config.js files handled in Task 34)

- [ ] **Step 3: Commit**

```bash
git add services/
git commit -m "test: retarget jest.mock from platform-core/lambda-utils/domain-core to event-processor"
```

---

### Task 34: Update jest.config.js moduleNameMapper across all projects

Every service and lib `jest.config.js` has moduleNameMapper entries for `@nestfolio/platform-core` and `@nestfolio/lambda-utils`. These need to be removed. Also add moduleNameMapper entries for the new `@nestfolio/<service>/domain` path aliases where the service consumes events from a producer.

**Rule for each jest.config.js:**
- Remove: `'^@nestfolio/platform-core$'` and `'^@nestfolio/platform-core/(.*)$'` entries
- Remove: `'^@nestfolio/lambda-utils$'` and `'^@nestfolio/lambda-utils/(.*)$'` entries
- Remove: `'^@nestfolio/domain-core$'` and `'^@nestfolio/domain-core/(.*)$'` entries (if present)
- Add (where the service imports from a producer's domain): `'^@nestfolio/<producer>/domain$': '<rootDir>/../../../services/<domain>/<producer>/src/domain/index.ts'`

**Projects to update:**
- All 11 service jest.config.js files (investor-bff, investor-ctrl, dashboard-bff, advisory-ctrl, advisory-bff, compliance-ctrl, execution-ctrl, execution-adpt, ledger-ctrl, ledger-bff, reconciliation-ctrl)
- 3 hub stack jest.config.js (investor-hub, advisory-hub, execution-hub) — remove old entries
- `libs/command-core/jest.config.js` — remove platform-core mapper
- `libs/cdk-constructs/jest.config.js` — remove lambda-utils and platform-core mappers
- `libs/event-processor/jest.config.js` — remove any platform-core or lambda-utils mappers
- `apps/investor-mfe/jest.config.ts` — add `@nestfolio/investor-bff/domain` mapper (if it imports from there)
- `services/investor/investor-web/jest.config.js` — remove lambda-utils mapper

Path depth note: services are at `services/<domain>/<service>/`, so relative paths from a service to another service's domain use `<rootDir>/../../../services/<domain>/<producer>/src/domain/index.ts`. Libs use `<rootDir>/../<lib>/src/...`.

- [ ] **Step 1: Update all jest.config.js files**

- [ ] **Step 2: Run full test suite**

Run: `npx nx run-many -t test --all`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add services/ libs/
git commit -m "build: update jest moduleNameMapper — remove old lib paths, add service domain aliases"
```

---

### Task 35: Delete platform-core, lambda-utils, and domain-core

**Files:**
- Delete: `libs/platform-core/` (entire directory)
- Delete: `libs/lambda-utils/` (entire directory)
- Delete: `libs/domain-core/` (entire directory)
- Modify: `tsconfig.base.json` (remove path aliases)

- [ ] **Step 1: Remove path aliases from tsconfig.base.json**

Remove these lines from the `paths` object:
```json
"@nestfolio/platform-core": ["libs/platform-core/src/index.ts"],
"@nestfolio/platform-core/*": ["libs/platform-core/src/*"],
"@nestfolio/domain-core": ["libs/domain-core/src/index.ts"],
"@nestfolio/domain-core/*": ["libs/domain-core/src/*"],
"@nestfolio/lambda-utils": ["libs/lambda-utils/src/index.ts"],
"@nestfolio/lambda-utils/*": ["libs/lambda-utils/src/*"],
```

- [ ] **Step 2: Delete the libraries**

```bash
rm -rf libs/platform-core libs/lambda-utils libs/domain-core
```

- [ ] **Step 3: Run full test suite**

Run: `npx nx run-many -t test --all`
Expected: ALL projects PASS

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove platform-core, lambda-utils, domain-core — consolidated into event-processor + service domains"
```

---

## Summary

| Chunk | Tasks | What happens |
|-------|-------|-------------|
| **1** | 1–9 | Platform-core modules → `event-processor/src/platform/` |
| **2** | 10–13 | Lambda-utils modules → `event-processor/src/lambda/` |
| **3** | 14–16 | Domain-core shared types → `event-processor/src/domain/` |
| **4** | 17–26 | Events/schemas/models → 9 publishing services' `src/domain/` |
| **5** | 27–32 | tsconfig aliases + rewire ALL source imports (platform-core + lambda-utils + domain-core → event-processor + service domains) + typed event-listener imports |
| **6** | 33–35 | Remove test mocks + update jest configs + delete 3 libraries |

**Total: 35 tasks, ~50 files created, ~150 files modified, 3 directories deleted.**
