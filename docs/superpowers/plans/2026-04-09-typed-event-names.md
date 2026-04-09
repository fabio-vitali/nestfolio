# Typed Event Names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate event name mismatches between CDK and runtime by making every event name a branded typed constant, removing CDC auto-expand, and bridging both layers through shared imports.

**Architecture:** New `libs/event-types` exports branded `EventName` type + `eventName()` factory. CDK constructs (`Ingress`, `Egress`, `Orchestration`) accept `EventName` instead of `string`. Domain registries (in adapters) wrap values in `eventName()`. Service stacks and handlers import the same typed constants — mismatch = compile error. CDC pipeline replaces silent null with `assertEventName()` throw.

**Tech Stack:** TypeScript branded types, Nx library, CDK constructs, event-processor pipeline

**Design spec:** `docs/superpowers/specs/2026-04-09-typed-event-names-design.md`

---

### Task 1: Create `libs/event-types` Library

**Files:**
- Create: `libs/event-types/src/index.ts`
- Create: `libs/event-types/test/index.test.ts`
- Create: `libs/event-types/project.json`
- Create: `libs/event-types/package.json`
- Create: `libs/event-types/tsconfig.json`
- Create: `libs/event-types/tsconfig.lib.json`
- Create: `libs/event-types/tsconfig.spec.json`
- Create: `libs/event-types/jest.config.js`
- Modify: `tsconfig.base.json`

- [ ] **Step 1: Write the failing test**

```typescript
// libs/event-types/test/index.test.ts
import { eventName, assertEventName } from '../src/index';
import type { EventName } from '../src/index';

describe('eventName', () => {
  it('returns the string value unchanged', () => {
    const result = eventName('ORDER_FILLED');
    expect(result).toBe('ORDER_FILLED');
  });

  it('preserves the literal type at runtime', () => {
    const result = eventName('GOAL_CREATED');
    // The value is still a plain string at runtime
    expect(typeof result).toBe('string');
  });

  it('can be used as a Record key', () => {
    const handlers: Partial<Record<EventName, () => void>> = {
      [eventName('ORDER_FILLED')]: () => {},
    };
    expect(handlers['ORDER_FILLED']).toBeDefined();
  });
});

describe('assertEventName', () => {
  it('returns the value when non-null', () => {
    const result = assertEventName('ORDER_FILLED', 'test context');
    expect(result).toBe('ORDER_FILLED');
  });

  it('throws when value is null', () => {
    expect(() => assertEventName(null, 'unmapped CDC')).toThrow(
      'Event name resolution failed: unmapped CDC',
    );
  });

  it('throws when value is undefined', () => {
    expect(() => assertEventName(undefined, 'missing field')).toThrow(
      'Event name resolution failed: missing field',
    );
  });

  it('throws when value is empty string', () => {
    expect(() => assertEventName('', 'empty passthrough')).toThrow(
      'Event name resolution failed: empty passthrough',
    );
  });
});
```

- [ ] **Step 2: Create project scaffold**

```json
// libs/event-types/project.json
{
  "name": "event-types",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "libs/event-types/src",
  "projectType": "library",
  "targets": {
    "build": {
      "executor": "@nx/js:tsc",
      "outputs": ["{options.outputPath}"],
      "options": {
        "outputPath": "dist/libs/event-types",
        "tsConfig": "libs/event-types/tsconfig.lib.json",
        "main": "libs/event-types/src/index.ts",
        "assets": []
      }
    },
    "test": {
      "executor": "@nx/jest:jest",
      "outputs": ["{workspaceRoot}/coverage/libs/event-types"],
      "options": {
        "jestConfig": "libs/event-types/jest.config.js",
        "passWithNoTests": true
      }
    },
    "lint": {
      "executor": "@nx/eslint:lint"
    }
  },
  "tags": ["scope:platform", "type:lib"]
}
```

```json
// libs/event-types/package.json
{
  "name": "@nestfolio/event-types",
  "version": "0.0.1",
  "private": true
}
```

```json
// libs/event-types/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "module": "commonjs" },
  "files": [],
  "include": [],
  "references": [
    { "path": "./tsconfig.lib.json" },
    { "path": "./tsconfig.spec.json" }
  ]
}
```

```json
// libs/event-types/tsconfig.lib.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "../../dist/out-tsc",
    "declaration": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts", "src/**/*.spec.ts", "jest.config.ts"]
}
```

```json
// libs/event-types/tsconfig.spec.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "../../dist/out-tsc",
    "module": "commonjs",
    "types": ["jest", "node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

```javascript
// libs/event-types/jest.config.js
const preset = require('../../jest.preset');

module.exports = {
  ...preset,
  displayName: 'event-types',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', {
      tsconfig: '<rootDir>/tsconfig.spec.json',
      diagnostics: false,
    }],
  },
};
```

- [ ] **Step 3: Add path alias to tsconfig.base.json**

Add this entry to `tsconfig.base.json` `compilerOptions.paths`:

```json
"@nestfolio/event-types": ["libs/event-types/src/index.ts"]
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm nx test event-types`
Expected: FAIL — `../src/index` not found (implementation doesn't exist yet)

- [ ] **Step 5: Write minimal implementation**

```typescript
// libs/event-types/src/index.ts

declare const __brand: unique symbol;

/** Branded event name type. Only constructable via eventName(). */
export type EventName = string & { readonly [__brand]: 'EventName' };

/**
 * Create a typed event name constant.
 * Preserves the literal type for autocomplete and refactoring.
 */
export function eventName<T extends string>(name: T): EventName & T {
  return name as EventName & T;
}

/**
 * Runtime assertion for the JSON serialization boundary.
 * Use in CDC pipeline after deserializing EVENT_TYPE_MAP.
 * Throws if the resolved name is falsy (unmapped record).
 */
export function assertEventName(
  resolved: string | null | undefined,
  context: string,
): EventName {
  if (!resolved) {
    throw new Error(`Event name resolution failed: ${context}`);
  }
  return resolved as EventName;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm nx test event-types`
Expected: PASS — all 6 tests green

- [ ] **Step 7: Build the library**

Run: `pnpm nx build event-types`
Expected: PASS — compiles and outputs to `dist/libs/event-types`

- [ ] **Step 8: Commit**

```bash
git add libs/event-types/ tsconfig.base.json
git commit -m "feat: add libs/event-types with branded EventName type"
```

---

### Task 2: Remove Auto-Expand from CDK Event Types

**Files:**
- Modify: `libs/cdk-constructs/src/core/event-types.ts`
- Modify: `libs/cdk-constructs/src/core/index.ts`

- [ ] **Step 1: Update type definitions in event-types.ts**

Replace the full contents of `libs/cdk-constructs/src/core/event-types.ts` with:

```typescript
// libs/cdk-constructs/src/core/event-types.ts
import type { EventName } from '@nestfolio/event-types';

// ── Type definitions ──────────────────────────────────────────────

export type FieldDispatch = {
  field: string;
  map: Record<string, EventName>;
  default?: EventName;
};

export type Passthrough = {
  field: string;
  passthrough: true;
  emits: EventName[];
};

export type ActionMapping = EventName | FieldDispatch | Passthrough;

export type RecordTypeConfig = {
  insert?: ActionMapping;
  modify?: ActionMapping;
  remove?: ActionMapping;
};

export type EventTypesMap = Record<string, RecordTypeConfig>;

// ── Runtime config types (serialized to EVENT_TYPE_MAP env var) ──

export type RuntimeFieldDispatch = {
  field: string;
  map: Record<string, string>;
  default?: string;
};

export type RuntimePassthrough = {
  field: string;
  passthrough: true;
};

export type RuntimeMapping = string | RuntimeFieldDispatch | RuntimePassthrough;
export type RuntimeConfig = Record<string, RuntimeMapping>;

// ── Utility functions ─────────────────────────────────────────────

/**
 * Flatten EventTypesMap into `{RecordType}:{ACTION}` keyed runtime config.
 * Every mapping must be explicit — no auto-expand.
 */
export function buildRuntimeConfig(eventTypes: EventTypesMap): RuntimeConfig {
  const config: RuntimeConfig = {};

  for (const [recordType, recordConfig] of Object.entries(eventTypes)) {
    for (const action of ['insert', 'modify', 'remove'] as const) {
      const mapping = recordConfig[action];
      if (!mapping) continue;
      const ddbAction = action.toUpperCase();
      if (typeof mapping === 'string') {
        config[`${recordType}:${ddbAction}`] = mapping;
      } else if ('passthrough' in mapping) {
        config[`${recordType}:${ddbAction}`] = { field: mapping.field, passthrough: true };
      } else {
        const entry: RuntimeFieldDispatch = { field: mapping.field, map: mapping.map as Record<string, string> };
        if (mapping.default) entry.default = mapping.default as string;
        config[`${recordType}:${ddbAction}`] = entry;
      }
    }
  }

  return config;
}

/**
 * Collect every possible event type string the service can emit.
 */
export function collectAllEventTypes(eventTypes: EventTypesMap): EventName[] {
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

/**
 * Extract DynamoDB Stream filter entries from the eventTypes map.
 * Returns one entry per record-type + action pair.
 */
export function extractFilters(
  eventTypes: EventTypesMap,
): Array<{ typeName: string; action: string }> {
  const filters: Array<{ typeName: string; action: string }> = [];

  for (const [recordType, recordConfig] of Object.entries(eventTypes)) {
    if (recordConfig.insert) filters.push({ typeName: recordType, action: 'INSERT' });
    if (recordConfig.modify) filters.push({ typeName: recordType, action: 'MODIFY' });
    if (recordConfig.remove) filters.push({ typeName: recordType, action: 'REMOVE' });
  }

  return filters;
}
```

- [ ] **Step 2: Verify barrel export in index.ts is still valid**

Check `libs/cdk-constructs/src/core/index.ts` — the existing export `export type { EventTypesMap, RecordTypeConfig, ActionMapping, FieldDispatch, Passthrough } from './event-types';` should still work since we kept all type names. No changes needed.

- [ ] **Step 3: Verify the lib compiles (expect failures in tests — that's Task 3)**

Run: `pnpm nx build cdk-constructs`
Expected: May show type errors in tests (which import the old auto-expand form). That's expected — we fix tests in Task 3.

---

### Task 3: Tighten Ingress and Orchestration Prop Types

**Files:**
- Modify: `libs/cdk-constructs/src/core/ingress.ts:14`
- Modify: `libs/cdk-constructs/src/core/orchestration.ts` (the `triggers` prop)

- [ ] **Step 1: Update Ingress to accept EventName[]**

In `libs/cdk-constructs/src/core/ingress.ts`, add the import and change the type:

```typescript
// Add at top of file, after other imports:
import type { EventName } from '@nestfolio/event-types';

// Change IngressProps.eventTypes from:
//   eventTypes: string[];
// To:
//   eventTypes: EventName[];
```

- [ ] **Step 2: Update Orchestration to accept EventName[]**

In `libs/cdk-constructs/src/core/orchestration.ts`, find the `triggers` prop and change it:

```typescript
// Add at top of file:
import type { EventName } from '@nestfolio/event-types';

// Change OrchestrationProps.triggers from:
//   triggers: string[];
// To:
//   triggers: EventName[];
```

- [ ] **Step 3: Verify constructs compile**

Run: `pnpm nx build cdk-constructs`
Expected: Type errors in downstream service stacks (expected — those are fixed in Task 6+). The lib itself should compile.

---

### Task 4: Update CDK Construct Tests

**Files:**
- Modify: `libs/cdk-constructs/test/core/event-types.test.ts`

- [ ] **Step 1: Rewrite tests for no-auto-expand world**

Replace the full contents of `libs/cdk-constructs/test/core/event-types.test.ts`:

```typescript
// libs/cdk-constructs/test/core/event-types.test.ts
import { eventName } from '@nestfolio/event-types';
import {
  buildRuntimeConfig,
  collectAllEventTypes,
  extractFilters,
} from '../../src/core/event-types';

describe('buildRuntimeConfig', () => {
  it('maps explicit per-action EventName strings', () => {
    const result = buildRuntimeConfig({
      'BalanceEvent': {
        insert: eventName('BALANCE_UPDATED'),
        modify: eventName('BALANCE_EVENT_UPDATED'),
      },
    });
    expect(result).toEqual({
      'BalanceEvent:INSERT': 'BALANCE_UPDATED',
      'BalanceEvent:MODIFY': 'BALANCE_EVENT_UPDATED',
    });
  });

  it('maps insert-only config (no modify)', () => {
    const result = buildRuntimeConfig({
      'OnboardingCompleted': { insert: eventName('ONBOARDING_COMPLETED') },
    });
    expect(result).toEqual({
      'OnboardingCompleted:INSERT': 'ONBOARDING_COMPLETED',
    });
  });

  it('serializes field dispatch to runtime format', () => {
    const result = buildRuntimeConfig({
      'Order': {
        insert: {
          field: 'status',
          map: {
            SUBMITTED: eventName('ORDER_SUBMITTED'),
            REJECTED: eventName('ORDER_REJECTED'),
          },
          default: eventName('ORDER_CREATED'),
        },
      },
    });
    expect(result).toEqual({
      'Order:INSERT': {
        field: 'status',
        map: { SUBMITTED: 'ORDER_SUBMITTED', REJECTED: 'ORDER_REJECTED' },
        default: 'ORDER_CREATED',
      },
    });
  });

  it('serializes passthrough to runtime format (without emits)', () => {
    const result = buildRuntimeConfig({
      'NormalizedEvent': {
        insert: {
          field: 'sk',
          passthrough: true,
          emits: [eventName('ORDER_FILLED'), eventName('ORDER_REJECTED')],
        },
      },
    });
    expect(result).toEqual({
      'NormalizedEvent:INSERT': { field: 'sk', passthrough: true },
    });
  });

  it('handles multiple record types with mixed configs', () => {
    const result = buildRuntimeConfig({
      'Goal': {
        insert: eventName('GOAL_CREATED'),
        modify: eventName('GOAL_UPDATED'),
      },
      'Deposit': {
        insert: eventName('DEPOSIT_INITIATED'),
        modify: eventName('DEPOSIT_UPDATED'),
      },
    });
    expect(result).toEqual({
      'Goal:INSERT': 'GOAL_CREATED',
      'Goal:MODIFY': 'GOAL_UPDATED',
      'Deposit:INSERT': 'DEPOSIT_INITIATED',
      'Deposit:MODIFY': 'DEPOSIT_UPDATED',
    });
  });

  it('includes remove action when defined', () => {
    const result = buildRuntimeConfig({
      'Session': {
        insert: eventName('SESSION_CREATED'),
        remove: eventName('SESSION_DELETED'),
      },
    });
    expect(result).toEqual({
      'Session:INSERT': 'SESSION_CREATED',
      'Session:REMOVE': 'SESSION_DELETED',
    });
  });
});

describe('collectAllEventTypes', () => {
  it('collects explicit per-action EventName strings', () => {
    const result = collectAllEventTypes({
      'Bar': {
        insert: eventName('BAR_INSERTED'),
        modify: eventName('BAR_MODIFIED'),
      },
    });
    expect(result).toEqual(expect.arrayContaining(['BAR_INSERTED', 'BAR_MODIFIED']));
  });

  it('collects all field dispatch map values and default', () => {
    const result = collectAllEventTypes({
      'Order': {
        insert: {
          field: 'status',
          map: {
            A: eventName('EVENT_A'),
            B: eventName('EVENT_B'),
          },
          default: eventName('EVENT_DEFAULT'),
        },
      },
    });
    expect(result).toEqual(expect.arrayContaining(['EVENT_A', 'EVENT_B', 'EVENT_DEFAULT']));
  });

  it('collects passthrough emits array', () => {
    const result = collectAllEventTypes({
      'NE': {
        insert: {
          field: 'sk',
          passthrough: true,
          emits: [eventName('X'), eventName('Y')],
        },
      },
    });
    expect(result).toEqual(expect.arrayContaining(['X', 'Y']));
  });

  it('deduplicates across record types', () => {
    const result = collectAllEventTypes({
      'A': { insert: eventName('SHARED') },
      'B': { insert: eventName('SHARED') },
    });
    expect(result.filter(t => t === 'SHARED')).toHaveLength(1);
  });
});

describe('extractFilters', () => {
  it('returns only defined actions', () => {
    const result = extractFilters({
      'Bar': { insert: eventName('BAR_CREATED') },
    });
    expect(result).toEqual([
      { typeName: 'Bar', action: 'INSERT' },
    ]);
  });

  it('returns INSERT and MODIFY when both defined', () => {
    const result = extractFilters({
      'Foo': {
        insert: eventName('FOO_CREATED'),
        modify: eventName('FOO_UPDATED'),
      },
    });
    expect(result).toEqual([
      { typeName: 'Foo', action: 'INSERT' },
      { typeName: 'Foo', action: 'MODIFY' },
    ]);
  });

  it('includes REMOVE when defined', () => {
    const result = extractFilters({
      'Baz': {
        insert: eventName('BAZ_CREATED'),
        remove: eventName('BAZ_DELETED'),
      },
    });
    expect(result).toEqual([
      { typeName: 'Baz', action: 'INSERT' },
      { typeName: 'Baz', action: 'REMOVE' },
    ]);
  });

  it('handles field dispatch and passthrough same as strings', () => {
    const result = extractFilters({
      'Order': {
        insert: { field: 'status', map: { A: eventName('X') } },
        modify: { field: 'status', map: { A: eventName('Y') } },
      },
    });
    expect(result).toEqual([
      { typeName: 'Order', action: 'INSERT' },
      { typeName: 'Order', action: 'MODIFY' },
    ]);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm nx test cdk-constructs`
Expected: PASS — all tests green

- [ ] **Step 3: Commit**

```bash
git add libs/cdk-constructs/
git commit -m "feat: remove CDC auto-expand, tighten EventTypesMap to EventName"
```

---

### Task 5: Update CDC Pipeline with assertEventName

**Files:**
- Modify: `libs/event-processor/src/pipelines/change-data-capture.ts:32-49`
- Modify: `libs/event-processor/test/pipelines/change-data-capture.test.ts`

- [ ] **Step 1: Update resolveEventType in change-data-capture.ts**

Replace the `resolveEventType` function (lines 32-50) with:

```typescript
function resolveEventType(
  record: StreamRecord,
  eventName: string,
  config: RuntimeConfig,
): string | null {
  const key = `${record.__typename}:${eventName}`;
  const mapping = config[key];
  if (!mapping) {
    throw new Error(`Event name resolution failed: unmapped CDC record ${key}`);
  }

  if (typeof mapping === 'string') return mapping;

  if ('passthrough' in mapping && mapping.passthrough) {
    const value = (record as Record<string, unknown>)[mapping.field] as string;
    if (!value) {
      throw new Error(`Event name resolution failed: passthrough field "${mapping.field}" is falsy for ${record.__typename}`);
    }
    return value;
  }

  // Field dispatch — null return for unmapped values is intentional
  const value = (record as Record<string, unknown>)[mapping.field] as string;
  return mapping.map[value] ?? mapping.default ?? null;
}
```

Note: We use inline throws rather than importing `assertEventName` from `@nestfolio/event-types`. This avoids adding a runtime dependency from event-processor → event-types for a single function. The `assertEventName()` utility in event-types exists for any future consumer that needs it.

- [ ] **Step 2: Update the "skips records not in the map" test to expect throw**

In `libs/event-processor/test/pipelines/change-data-capture.test.ts`, replace the test at lines 47-58:

```typescript
    it('throws for records not in the map', async () => {
      process.env.EVENT_TYPE_MAP = JSON.stringify({
        'Order:INSERT': 'ORDER_CREATED',
      });
      const handler = changeDataCapture();
      await expect(handler({
        Records: [
          fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'Guard#1', __typename: 'Guard', tenantId: 't1' }),
        ],
      })).rejects.toThrow('Event name resolution failed: unmapped CDC record Guard:INSERT');
    });
```

- [ ] **Step 3: Add test for passthrough with falsy field**

Add this test inside the `passthrough mapping` describe block (after the existing test):

```typescript
    it('throws when passthrough field is falsy', async () => {
      process.env.EVENT_TYPE_MAP = JSON.stringify({
        'NormalizedEvent:INSERT': { field: 'sk', passthrough: true },
      });
      const handler = changeDataCapture();
      await expect(handler({
        Records: [
          fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: '', __typename: 'NormalizedEvent', tenantId: 't1' }),
        ],
      })).rejects.toThrow('Event name resolution failed: passthrough field "sk" is falsy');
    });
```

- [ ] **Step 4: Run tests**

Run: `pnpm nx test event-processor`
Expected: PASS — all tests green (including the updated throw expectations)

- [ ] **Step 5: Commit**

```bash
git add libs/event-processor/
git commit -m "feat: CDC resolveEventType throws on unmapped records instead of silent null"
```

---

### Task 6: Migrate Domain Event Registries to eventName()

> This task covers all 26 `events.ts` files. The transformation is mechanical: add import, wrap values.
> Each domain can be done in parallel. Showing the pattern with representative examples.

**Files:**
- Modify: All `services/*/src/domain/events.ts` files (26 total)

- [ ] **Step 1: Migrate execution-adpt events (representative adapter)**

In `services/execution/execution-adpt/src/domain/events.ts`, replace:

```typescript
import { eventName } from '@nestfolio/event-types';

export const ExecutionCrossDomainEventTypes = {
  ORDER_STAGED: eventName('ORDER_STAGED'),
  ORDER_REJECTED: eventName('ORDER_REJECTED'),
  ORDER_CANCELLED: eventName('ORDER_CANCELLED'),
  ORDER_ESCALATED: eventName('ORDER_ESCALATED'),
  BROKER_CIRCUIT_OPEN: eventName('BROKER_CIRCUIT_OPEN'),
  ORDER_FILLED: eventName('ORDER_FILLED'),
  ORDER_PARTIALLY_FILLED: eventName('ORDER_PARTIALLY_FILLED'),
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

- [ ] **Step 2: Apply same pattern to all other adapters and services**

For every `events.ts` file across all 4 domains:
1. Add `import { eventName } from '@nestfolio/event-types';`
2. Wrap every string value: `'FOO': 'FOO'` → `FOO: eventName('FOO')`

Special cases:
- `onboarding-bff/src/domain/events.ts` — individual exports: `export const ONBOARDING_COMPLETED = eventName('ONBOARDING_COMPLETED');`
- `decision-workflow-ctrl/src/domain/events.ts` — raw string arrays (`TRIGGER_EVENT_TYPES` etc.): wrap each element in `eventName()`
- Services with `new Set([...])` (investor-profile-ctrl, portfolio-engine-ctrl, advisory-narrative-ctrl, market-intelligence-ctrl): keep as `Set<string>`, wrap values in `eventName()` — the string coercion works fine for Set.has() checks

- [ ] **Step 3: Add missing event constants for auto-expand removal**

These events are produced by auto-expand today but need explicit constants. Add to the appropriate `events.ts`:

```typescript
// advisory-ctrl/src/domain/events.ts — add to AdvisoryCtrlEventTypes:
AGENT_INVOCATION_CREATED: eventName('AGENT_INVOCATION_CREATED'),
AGENT_INVOCATION_UPDATED: eventName('AGENT_INVOCATION_UPDATED'),
WORKFLOW_STATE_CREATED: eventName('WORKFLOW_STATE_CREATED'),
WORKFLOW_STATE_UPDATED: eventName('WORKFLOW_STATE_UPDATED'),

// compliance-ctrl/src/domain/events.ts — add to ComplianceEventTypes:
AUDIT_ARTIFACT_CREATED: eventName('AUDIT_ARTIFACT_CREATED'),
AUDIT_ARTIFACT_UPDATED: eventName('AUDIT_ARTIFACT_UPDATED'),

// advisory-bff/src/domain/events.ts — add to AdvisoryBffEventTypes:
DECISION_READ_MODEL_CREATED: eventName('DECISION_READ_MODEL_CREATED'),
DECISION_READ_MODEL_UPDATED: eventName('DECISION_READ_MODEL_UPDATED'),
USER_INTERACTION_CREATED: eventName('USER_INTERACTION_CREATED'),
USER_INTERACTION_UPDATED: eventName('USER_INTERACTION_UPDATED'),

// decision-workflow-ctrl/src/domain/events.ts — add to DecisionWorkflowEventTypes:
WORKFLOW_TRIGGER_CREATED: eventName('WORKFLOW_TRIGGER_CREATED'),
WORKFLOW_TRIGGER_UPDATED: eventName('WORKFLOW_TRIGGER_UPDATED'),
AGENT_OUTPUT_CREATED: eventName('AGENT_OUTPUT_CREATED'),
AGENT_OUTPUT_UPDATED: eventName('AGENT_OUTPUT_UPDATED'),

// execution-ctrl/src/domain/events.ts — add to ExecutionCtrlEventTypes:
STAGED_ORDER_CREATED: eventName('STAGED_ORDER_CREATED'),
STAGED_ORDER_UPDATED: eventName('STAGED_ORDER_UPDATED'),

// investor-ctrl/src/domain/events.ts — add to InvestorCtrlEventTypes:
MONTHLY_REPORT_CREATED: eventName('MONTHLY_REPORT_CREATED'),
MONTHLY_REPORT_UPDATED: eventName('MONTHLY_REPORT_UPDATED'),

// investor-bff/src/domain/events.ts — add to InvestorBffEventTypes:
INVESTOR_PROFILE_CREATED: eventName('INVESTOR_PROFILE_CREATED'),
INVESTOR_PROFILE_UPDATED: eventName('INVESTOR_PROFILE_UPDATED'),
DEPOSIT_UPDATED: eventName('DEPOSIT_UPDATED'),
WITHDRAWAL_UPDATED: eventName('WITHDRAWAL_UPDATED'),
EXECUTION_MODE_CHANGE_UPDATED: eventName('EXECUTION_MODE_CHANGE_UPDATED'),
```

- [ ] **Step 4: Verify build**

Run: `pnpm nx run-many -t build --projects=investor-adpt,advisory-adpt,execution-adpt,ledger-adpt`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/
git commit -m "feat: migrate all domain event registries to eventName()"
```

---

### Task 7: Migrate Service Stacks — Egress eventTypes

> Convert auto-expand shorthands to explicit mappings and replace all string literals with typed constants.

**Files:**
- Modify: All `services/*/src/service.stack.ts` files with Egress (22 services)

- [ ] **Step 1: Convert auto-expand services (representative example: investor-bff)**

In `services/investor/investor-bff/src/service.stack.ts`, replace the Egress eventTypes block:

```typescript
// Add import at top:
import { InvestorBffEventTypes } from './domain/events';

// Replace eventTypes in Egress:
const egress = new Egress(this, 'Egress', {
  state,
  eventTypes: {
    'Goal': {
      insert: InvestorBffEventTypes.GOAL_CREATED,
      modify: InvestorBffEventTypes.GOAL_UPDATED,
    },
    'RiskProfile': {
      insert: InvestorBffEventTypes.RISK_PROFILE_CREATED,
      modify: InvestorBffEventTypes.RISK_PROFILE_UPDATED,
    },
    'Mandate': {
      insert: InvestorBffEventTypes.MANDATE_CREATED,
      modify: InvestorBffEventTypes.MANDATE_UPDATED,
    },
    'OperatingModeRecord': {
      insert: InvestorBffEventTypes.OPERATING_MODE_SELECTED,
      modify: InvestorBffEventTypes.OPERATING_MODE_CHANGED,
    },
    'InvestorProfile': {
      insert: InvestorBffEventTypes.INVESTOR_PROFILE_CREATED,
      modify: InvestorBffEventTypes.INVESTOR_PROFILE_UPDATED,
    },
    'Deposit': {
      insert: InvestorBffEventTypes.DEPOSIT_INITIATED,
      modify: InvestorBffEventTypes.DEPOSIT_UPDATED,
    },
    'Withdrawal': {
      insert: InvestorBffEventTypes.WITHDRAWAL_REQUESTED,
      modify: InvestorBffEventTypes.WITHDRAWAL_UPDATED,
    },
    'ExecutionModeChange': {
      insert: InvestorBffEventTypes.EXECUTION_MODE_CHANGED,
      modify: InvestorBffEventTypes.EXECUTION_MODE_CHANGE_UPDATED,
    },
    'Notification': {
      modify: InvestorBffEventTypes.NOTIFICATION_READ,
    },
  },
});
```

- [ ] **Step 2: Convert advisory-ctrl auto-expand**

In `services/advisory/advisory-ctrl/src/service.stack.ts`, replace:

```typescript
import { AdvisoryCtrlEventTypes } from './domain/events';

// In Egress eventTypes:
eventTypes: {
  'DecisionPacket': {
    insert: AdvisoryCtrlEventTypes.DECISION_PACKET_CREATED,
    modify: AdvisoryCtrlEventTypes.DECISION_PACKET_UPDATED,
  },
  'AgentInvocation': {
    insert: AdvisoryCtrlEventTypes.AGENT_INVOCATION_CREATED,
    modify: AdvisoryCtrlEventTypes.AGENT_INVOCATION_UPDATED,
  },
  'WorkflowState': {
    insert: AdvisoryCtrlEventTypes.WORKFLOW_STATE_CREATED,
    modify: AdvisoryCtrlEventTypes.WORKFLOW_STATE_UPDATED,
  },
},
```

- [ ] **Step 3: Apply same pattern to remaining 6 auto-expand services**

Convert remaining auto-expand services following the same pattern:
- `compliance-ctrl` — AuditArtifact
- `advisory-bff` — DecisionReadModel, UserInteraction
- `decision-workflow-ctrl` — WorkflowTrigger, DecisionPacket, AgentOutput
- `execution-ctrl` — StagedOrder
- `investor-ctrl` — Notification, MonthlyReport

- [ ] **Step 4: Replace string literals in already-explicit Egress services**

For the 14 services already using `{ insert: 'EVENT_NAME' }` syntax, replace each string with the imported typed constant. Example for any service:

```typescript
// BEFORE
'BalanceEvent': { insert: 'BALANCE_UPDATED' },

// AFTER
import { LedgerCtrlEventTypes } from './domain/events';
'BalanceEvent': { insert: LedgerCtrlEventTypes.BALANCE_UPDATED },
```

- [ ] **Step 5: Verify build**

Run: `pnpm nx run-many -t build`
Expected: May still fail on Ingress string arrays (fixed in Task 8). Egress types should compile.

- [ ] **Step 6: Commit**

```bash
git add services/
git commit -m "feat: migrate all Egress eventTypes to typed constants, remove auto-expand"
```

---

### Task 8: Migrate Service Stacks — Ingress eventTypes

> Replace string arrays with typed constant imports.

**Files:**
- Modify: All `services/*/src/service.stack.ts` files with Ingress (~18 services needing changes)

- [ ] **Step 1: Migrate investor-bff Ingress (representative example)**

In `services/investor/investor-bff/src/service.stack.ts`:

```typescript
// Add imports (some may already be present from Task 7):
import { InvestorBffEventTypes } from './domain/events';
import { InvestorCtrlEventTypes } from '@nestfolio/investor-ctrl/events';
import { LedgerCrossDomainEventTypes } from '@nestfolio/ledger-adpt/domain';

// Replace Ingress eventTypes:
const ingress = new Ingress(this, 'Ingress', {
  state,
  eventTypes: [
    InvestorBffEventTypes.USER_REGISTERED,
    InvestorCtrlEventTypes.NOTIFICATION_CREATED,
    LedgerCrossDomainEventTypes.BALANCE_UPDATED,
    InvestorBffEventTypes.ONBOARDING_COMPLETED,
    InvestorBffEventTypes.GO_LIVE_CONFIRMED,
  ],
});
```

Note: Verify which events.ts each event constant lives in. Some may need to be added. Use the existing path aliases (`@nestfolio/investor-ctrl/events`, `@nestfolio/ledger-adpt/domain`, etc.) from `tsconfig.base.json`.

- [ ] **Step 2: Migrate advisory-ctrl Ingress (representative cross-domain example)**

In `services/advisory/advisory-ctrl/src/service.stack.ts`:

```typescript
import { AdvisoryIngestEventTypes } from '@nestfolio/advisory-adpt/domain';
import { AdvisoryCtrlEventTypes } from './domain/events';

// Replace Ingress eventTypes — use adapter ingest types for cross-domain events:
eventTypes: [
  AdvisoryIngestEventTypes.MANDATE_CREATED,
  AdvisoryIngestEventTypes.GOAL_CREATED,
  AdvisoryIngestEventTypes.GOAL_UPDATED,
  AdvisoryIngestEventTypes.RISK_PROFILE_CREATED,
  AdvisoryIngestEventTypes.RISK_PROFILE_UPDATED,
  AdvisoryIngestEventTypes.OPERATING_MODE_CHANGED,
  AdvisoryIngestEventTypes.PORTFOLIO_DRIFT_DETECTED,
  AdvisoryIngestEventTypes.ORDER_FILLED,
  AdvisoryIngestEventTypes.ORDER_REJECTED,
  AdvisoryIngestEventTypes.ORDER_CANCELLED,
  AdvisoryIngestEventTypes.DEPOSIT_DETECTED,
  AdvisoryCtrlEventTypes.DECISION_APPROVED,
  AdvisoryCtrlEventTypes.DECISION_BLOCKED,
  AdvisoryCtrlEventTypes.USER_CONFIRMED,
  AdvisoryCtrlEventTypes.USER_REJECTED,
],
```

Note: `USER_REJECTED` and `DECISION_BLOCKED` — verify these exist in events.ts. Add if missing.

- [ ] **Step 3: Apply same pattern to remaining ~16 services with Ingress**

For each service, identify which events come from:
- Same service's `events.ts` (internal events)
- Same domain adapter's events (intra-domain cross-service)
- Other domain adapter's events (cross-domain via `@nestfolio/{domain}-adpt/domain`)

- [ ] **Step 4: Build all projects**

Run: `pnpm nx run-many -t build`
Expected: PASS — all 33 services compile with typed EventName[] in Ingress

- [ ] **Step 5: Run all unit tests**

Run: `pnpm nx run-many -t test`
Expected: PASS — CDK snapshot tests may need updating if snapshots include the EVENT_TYPE_MAP env var (which will change format since auto-expand produces different JSON)

- [ ] **Step 6: Commit**

```bash
git add services/
git commit -m "feat: migrate all Ingress eventTypes to typed EventName constants"
```

---

### Task 9: Migrate Handler Subscriptions to Typed Constants

> Replace string literal handler keys and inline comparisons.

**Files:**
- Modify: `services/*/src/handlers/event-listener.ts` (services with hardcoded string keys)
- Modify: `services/advisory/advisory-ctrl/src/handlers/event-listener.ts`
- Modify: `services/advisory/decision-workflow-ctrl/src/handlers/sfn-callback.ts`
- Modify: `services/ledger/ledger-ctrl/src/handlers/event-listener.ts`
- Modify: `services/execution/broker-ctrl/src/handlers/callback-resolver.ts`

- [ ] **Step 1: Replace inline string comparisons (5 locations)**

In `services/advisory/advisory-ctrl/src/handlers/event-listener.ts`, replace:
```typescript
// BEFORE: ctx.eventType === 'DECISION_APPROVED'
// AFTER:
import { AdvisoryCtrlEventTypes } from '../domain/events';
// ... ctx.eventType === AdvisoryCtrlEventTypes.DECISION_APPROVED
```

Same pattern for all 5 locations listed in the design spec.

- [ ] **Step 2: Replace string handler keys in remaining services**

For handlers that use `Record<string, Handler>` with string keys, switch to computed property keys:

```typescript
// BEFORE
const handlers: Record<string, Handler> = {
  'ORDER_FILLED': (payload, ctx) => processOrder(deps, payload, ctx),
};

// AFTER
import { ExecutionCrossDomainEventTypes } from '@nestfolio/execution-adpt/domain';
const handlers: Record<string, Handler> = {
  [ExecutionCrossDomainEventTypes.ORDER_FILLED]: (payload, ctx) => processOrder(deps, payload, ctx),
};
```

- [ ] **Step 3: Run all tests**

Run: `pnpm nx run-many -t test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add services/
git commit -m "feat: migrate handler subscriptions to typed event constants"
```

---

### Task 10: Final Verification

- [ ] **Step 1: Full build**

Run: `pnpm nx run-many -t build`
Expected: PASS — all projects compile

- [ ] **Step 2: Full unit test suite**

Run: `pnpm nx run-many -t test`
Expected: PASS

- [ ] **Step 3: Integration tests**

Run: `pnpm nx run-many -t test-integration --parallel=4`
Expected: PASS

- [ ] **Step 4: Spot-check compile-time safety**

Temporarily change a typed event name in a service stack to a raw string:

```typescript
// In any service.stack.ts Ingress:
eventTypes: ['FAKE_EVENT'],  // Should be a compile error
```

Run: `pnpm nx build <service-name>`
Expected: FAIL — `Type 'string' is not assignable to type 'EventName'`

Revert the change.

- [ ] **Step 5: Spot-check handler safety**

Temporarily use a raw string as a handler key:

```typescript
const handlers = {
  'MISSPELLED_EVENT': (p, c) => {},  // Should still work (Record<string, H>)
};
```

Note: Handler keys are `Record<string, Handler>` — the safety comes from using computed property keys `[TypedConstant.NAME]`, not from the Record type. The type system prevents assigning a branded EventName where a string is expected, but not vice versa. This is the pragmatic tradeoff — naming discipline at the handler level comes from importing constants, not from the Record type.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: typed event names — complete migration"
```
