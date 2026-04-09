# Typed Event Names Design

## Problem

Event name mismatches between CDK declarations and runtime handler subscriptions have been the #1 source of integration bugs. The root causes:

1. **No single typed constant** — event names appear as independent string literals in CDK `eventTypes`, Ingress `eventTypes`, handler subscriptions, and adapter registries. Each is maintained independently.
2. **CDC auto-expand hides names** — `'ORDER'` silently becomes `ORDER_CREATED`/`ORDER_UPDATED` via string concatenation in `buildRuntimeConfig()`. These expanded names are never declared as constants.
3. **Silent failures** — `resolveEventType()` returns `null` on unmapped pairs. Records are silently dropped with no error, log, or metric.
4. **Ingress is untyped** — `IngressProps.eventTypes: string[]` accepts any string with zero compile-time validation.

## Solution

Branded `EventName` type + explicit typed constants + removal of CDC auto-expand. Every event name in the system becomes a visible, importable, refactorable constant. Both CDK stacks and runtime handlers import the same constant — a mismatch is a compile error.

## Design

### 1. Shared Library: `libs/event-types`

A tiny, stable library that exports only the branded type and factory function. Rarely changes, so nx affected impact is minimal.

```typescript
// libs/event-types/src/index.ts

declare const __brand: unique symbol;

/** Branded event name type. Only constructable via eventName(). */
export type EventName = string & { readonly [__brand]: 'EventName' };

/** Create a typed event name constant. */
export function eventName<T extends string>(name: T): EventName & T {
  return name as EventName & T;
}

/**
 * Runtime assertion for the JSON serialization boundary.
 * Use in CDC pipeline after deserializing EVENT_TYPE_MAP.
 * Throws if the resolved name is falsy (unmapped record).
 */
export function assertEventName(resolved: string | null | undefined, context: string): EventName {
  if (!resolved) {
    throw new Error(`Event name resolution failed: ${context}`);
  }
  return resolved as EventName;
}
```

**Key properties:**
- `eventName()` preserves the literal type via `<T extends string>` — enables autocomplete and refactoring
- `assertEventName()` replaces silent `null` returns in CDC with loud failures
- No suffix union, no naming convention enforcement — naming is a code review concern

### 2. Domain Event Registries (in adapters, unchanged location)

Values stay in `*-adpt/src/domain/events.ts` — nx affected granularity preserved.

```typescript
// services/execution/execution-adpt/src/domain/events.ts
import { eventName } from '@nestfolio/event-types';

export const ExecutionCrossDomainEventTypes = {
  ORDER_FILLED: eventName('ORDER_FILLED'),
  ORDER_REJECTED: eventName('ORDER_REJECTED'),
  ORDER_CANCELLED: eventName('ORDER_CANCELLED'),
  ORDER_STAGED: eventName('ORDER_STAGED'),
  ORDER_ESCALATED: eventName('ORDER_ESCALATED'),
  ORDER_PARTIALLY_FILLED: eventName('ORDER_PARTIALLY_FILLED'),
  BROKER_CIRCUIT_OPEN: eventName('BROKER_CIRCUIT_OPEN'),
  DEPOSIT_DETECTED: eventName('DEPOSIT_DETECTED'),
  WITHDRAWAL_COMPLETED: eventName('WITHDRAWAL_COMPLETED'),
  TRANSFER_FAILED: eventName('TRANSFER_FAILED'),
  CORPORATE_ACTION_APPLIED: eventName('CORPORATE_ACTION_APPLIED'),
  PORTFOLIO_SNAPSHOT_IMPORTED: eventName('PORTFOLIO_SNAPSHOT_IMPORTED'),
  ALPACA_ACCOUNT_SNAPSHOT: eventName('ALPACA_ACCOUNT_SNAPSHOT'),
} as const;

export const ExecutionIngestEventTypes = {
  DECISION_APPROVED: eventName('DECISION_APPROVED'),
  DECISION_PACKET_CREATED: eventName('DECISION_PACKET_CREATED'),
  USER_CONFIRMED: eventName('USER_CONFIRMED'),
  CIRCUIT_BREAKER_TRIGGERED: eventName('CIRCUIT_BREAKER_TRIGGERED'),
  CIRCUIT_BREAKER_RESET: eventName('CIRCUIT_BREAKER_RESET'),
  DEPOSIT_INITIATED: eventName('DEPOSIT_INITIATED'),
  WITHDRAWAL_REQUESTED: eventName('WITHDRAWAL_REQUESTED'),
  ACCOUNT_CLOSURE_REQUESTED: eventName('ACCOUNT_CLOSURE_REQUESTED'),
  EXECUTION_MODE_CHANGED: eventName('EXECUTION_MODE_CHANGED'),
} as const;
```

**No renames.** Every existing event name is wrapped in `eventName()` as-is.

### 3. CDK Construct Changes

#### Ingress — `string[]` becomes `EventName[]`

```typescript
// libs/cdk-constructs/src/core/ingress.ts
import type { EventName } from '@nestfolio/event-types';

export interface IngressProps {
  eventTypes: EventName[];  // was: string[]
  // ... rest unchanged
}
```

Service stacks must now pass typed constants:

```typescript
// BEFORE
new Ingress(this, 'Ingress', {
  eventTypes: ['MANDATE_CREATED', 'GOAL_CREATED', 'GOAL_UPDATED'],
});

// AFTER
import { AdvisoryIngestEventTypes } from '@nestfolio/advisory-adpt/domain';

new Ingress(this, 'Ingress', {
  eventTypes: [
    AdvisoryIngestEventTypes.GOAL_CREATED,
    AdvisoryIngestEventTypes.GOAL_UPDATED,
    AdvisoryIngestEventTypes.MANDATE_CREATED,
  ],
});
```

Raw strings → compile error.

#### Egress — EventTypesMap tightened + auto-expand removed

```typescript
// libs/cdk-constructs/src/core/event-types.ts
import type { EventName } from '@nestfolio/event-types';

export type FieldDispatch = {
  field: string;
  map: Record<string, EventName>;   // was: Record<string, string>
  default?: EventName;               // was: string
};

export type Passthrough = {
  field: string;
  passthrough: true;
  emits: EventName[];                // was: string[]
};

export type ActionMapping = EventName | FieldDispatch | Passthrough;  // was: string | ...

// REMOVED: RecordTypeConfig no longer accepts bare string for auto-expand
export type RecordTypeConfig = {
  insert?: ActionMapping;
  modify?: ActionMapping;
  remove?: ActionMapping;
};

export type EventTypesMap = Record<string, RecordTypeConfig>;
```

Service stacks must declare explicit per-action mappings:

```typescript
// BEFORE (auto-expand)
eventTypes: { 'Goal': 'GOAL' }  // hidden: GOAL_CREATED, GOAL_UPDATED

// AFTER (explicit)
import { InvestorEventTypes } from './domain/events';

eventTypes: {
  'Goal': {
    insert: InvestorEventTypes.GOAL_CREATED,
    modify: InvestorEventTypes.GOAL_UPDATED,
  },
}
```

Every event name is visible in code. No hidden concatenation.

#### buildRuntimeConfig — simplified

```typescript
export function buildRuntimeConfig(eventTypes: EventTypesMap): RuntimeConfig {
  const config: RuntimeConfig = {};

  for (const [recordType, recordConfig] of Object.entries(eventTypes)) {
    // No more auto-expand branch — every mapping is explicit
    for (const action of ['insert', 'modify', 'remove'] as const) {
      const mapping = recordConfig[action];
      if (!mapping) continue;
      const ddbAction = action.toUpperCase();

      if (typeof mapping === 'string') {
        config[`${recordType}:${ddbAction}`] = mapping;
      } else if ('passthrough' in mapping) {
        config[`${recordType}:${ddbAction}`] = { field: mapping.field, passthrough: true };
      } else {
        const entry: RuntimeFieldDispatch = { field: mapping.field, map: mapping.map };
        if (mapping.default) entry.default = mapping.default;
        config[`${recordType}:${ddbAction}`] = entry;
      }
    }
  }

  return config;
}
```

#### collectAllEventTypes — simplified

```typescript
export function collectAllEventTypes(eventTypes: EventTypesMap): EventName[] {  // was: string[]
  const types: EventName[] = [];

  for (const recordConfig of Object.values(eventTypes)) {
    for (const mapping of [recordConfig.insert, recordConfig.modify, recordConfig.remove]) {
      if (!mapping) continue;
      if (typeof mapping === 'string') {
        types.push(mapping as EventName);
      } else if ('passthrough' in mapping) {
        types.push(...mapping.emits);
      } else {
        types.push(...Object.values(mapping.map));
        if (mapping.default) types.push(mapping.default);
      }
    }
  }

  return [...new Set(types)] as EventName[];
}
```

### 4. Runtime Handler Changes

Handlers use typed constants as subscription keys:

```typescript
// BEFORE
const handlers: Record<string, Handler> = {
  'ORDER_FILLED': (payload, ctx) => processOrder(deps, payload, ctx),
  'DEPOSIT_DETECTED': (payload, ctx) => processDeposit(deps, payload, ctx),
};

// AFTER
import type { EventName } from '@nestfolio/event-types';
import { ExecutionCrossDomainEventTypes } from '@nestfolio/execution-adpt/domain';

const handlers: Partial<Record<EventName, Handler>> = {
  [ExecutionCrossDomainEventTypes.ORDER_FILLED]: (payload, ctx) => processOrder(deps, payload, ctx),
  [ExecutionCrossDomainEventTypes.DEPOSIT_DETECTED]: (payload, ctx) => processDeposit(deps, payload, ctx),
};
```

### 5. CDC Pipeline — assertEventName replaces silent null

```typescript
// libs/event-processor/src/pipelines/change-data-capture.ts

import { assertEventName } from '@nestfolio/event-types';

// In resolveEventType():
// BEFORE
const key = `${record.__typename}:${eventName}`;
return config[key] ?? null;  // silent drop

// AFTER
const key = `${record.__typename}:${eventName}`;
const resolved = config[key];
return assertEventName(resolved, `unmapped CDC record: ${key}`);
```

### 6. CDK↔Runtime Type Bridge

```
                ┌──────────────────────────────────────┐
                │  @nestfolio/execution-adpt/domain     │
                │  ExecutionCrossDomainEventTypes        │
                │    ORDER_FILLED: EventName & 'ORDER_FILLED'
                └──────────┬──────────┬────────────────┘
                           │          │
                ┌──────────▼──┐  ┌────▼──────────────────┐
                │  CDK Stack   │  │  Runtime Handler       │
                │  Ingress({   │  │  handlers = {          │
                │    eventTypes│  │    [ORDER_FILLED]: fn  │
                │    : [ORDER_ │  │  }                     │
                │      FILLED] │  │                        │
                │  })          │  │  Record<EventName, H>  │
                └─────────────┘  └─────────────────────────┘
                     │                      │
                     └───── SAME CONSTANT ──┘
                        rename once → both update
                        typo → compile error
```

### 7. nx affected Behavior

| Change | What's affected |
|--------|----------------|
| `libs/event-types` (branded type, factory fn) | All services — but this lib almost never changes |
| `execution-adpt/domain/events.ts` (add/rename event) | execution-adpt + its dependents (execution-ctrl, ledger-ctrl, advisory-ctrl, etc.) |
| `advisory-adpt/domain/events.ts` (add/rename event) | advisory-adpt + its dependents |
| Service stack (rewire eventTypes) | Only that service |
| Handler (change subscription) | Only that service |

Same granularity as today. The shared lib is a leaf dependency that almost never changes.

## Migration

### Phase 1: Foundation
- Create `libs/event-types` Nx library
- Export `EventName`, `eventName()`, `assertEventName()`
- Update `libs/cdk-constructs/src/core/event-types.ts` — remove auto-expand from types, tighten to `EventName`
- Update `libs/cdk-constructs/src/core/ingress.ts` — `eventTypes: EventName[]`
- Update `libs/cdk-constructs/src/core/egress.ts` — consume new `EventTypesMap`
- Update `buildRuntimeConfig()`, `collectAllEventTypes()`, `extractFilters()`
- Update `libs/cdk-constructs` tests

### Phase 2: Domain Registries (4 adapters)
- Wrap all event name constants in `eventName()` across:
  - `services/investor/investor-adpt/src/domain/events.ts`
  - `services/advisory/advisory-adpt/src/domain/events.ts`
  - `services/execution/execution-adpt/src/domain/events.ts`
  - `services/ledger/ledger-adpt/src/domain/events.ts`
- Also wrap internal service events (non-cross-domain) in each service's `domain/events.ts`

### Phase 3: Service Stacks (33 services)
- Replace auto-expand strings with explicit per-action declarations
- Replace Ingress string arrays with typed constant imports
- Compiler errors guide the work — fix each until `nx build` passes

### Phase 4: Handler Subscriptions
- Replace string literal handler keys with typed constant references
- Replace inline string comparisons (`ctx.eventType === 'DECISION_APPROVED'`) with constant references

### Phase 5: CDC Safety Net
- Replace `resolveEventType()` silent null return with `assertEventName()` throw
- Add CloudWatch error metric for unmapped CDC records

## Verification

1. **Compile**: `pnpm nx run-many -t build` — all 33 services must compile
2. **Unit tests**: `pnpm nx run-many -t test` — all existing tests pass
3. **CDK synth**: `pnpm nx run-many -t synth` — all stacks synthesize
4. **Integration tests**: `pnpm nx run-many -t test-integration --parallel=4` — all pass
5. **Type safety spot-check**: Intentionally misspell an event name in a service stack — verify compile error

## Files Modified

| File | Change |
|------|--------|
| `libs/event-types/src/index.ts` | **NEW** — branded type, factory, assertion |
| `libs/cdk-constructs/src/core/event-types.ts` | Remove auto-expand, tighten to EventName |
| `libs/cdk-constructs/src/core/ingress.ts` | `eventTypes: EventName[]` |
| `libs/cdk-constructs/src/core/egress.ts` | Consume new EventTypesMap |
| `libs/cdk-constructs/test/core/event-types.test.ts` | Update for no auto-expand |
| `services/*/src/domain/events.ts` (all 33) | Wrap in `eventName()` |
| `services/*/src/service.stack.ts` (all 33) | Explicit eventTypes + typed Ingress |
| `services/*/src/handlers/event-listener.ts` (services with Ingress) | Typed handler keys |
| `libs/event-processor/src/pipelines/change-data-capture.ts` | assertEventName() |
