# @nestfolio/event-processor Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a declarative event processing framework that provides transparent idempotency, parallelism with backpressure, per-record error collection, and pre-configured pipelines for all nestfolio event-driven services.

**Architecture:** Intent-based processing engine where handlers return `WriteIntent` data objects (`record`, `project`, `accumulate`, `s3Put`, `skip`). The engine interprets intents, applies idempotency guards transparently, and handles all cross-cutting concerns (parsing, tracing, metrics, error collection). Two engine variants: `batch-engine` for SQS, `stream-engine` for DDB Streams.

**Tech Stack:** TypeScript, p-limit, @aws-sdk/lib-dynamodb, @aws-sdk/client-s3, @aws-sdk/client-eventbridge, @nestfolio/lambda-utils

**Spec:** `docs/superpowers/specs/2026-03-15-event-processor-design.md`

---

## File Structure

```
libs/event-processor/
├── project.json
├── tsconfig.json
├── tsconfig.lib.json
├── tsconfig.spec.json
├── jest.config.js
├── src/
│   ├── index.ts                           # Public API exports
│   │
│   ├── types/
│   │   ├── write-intent.ts                # WriteIntent union + RecordIntent, ProjectIntent, etc.
│   │   ├── handler-config.ts              # HandlerFn, HandlerEntry, EventPayload
│   │   ├── event-context.ts               # EventContext interface
│   │   ├── stream-types.ts                # StreamRecord, StreamContext interfaces
│   │   └── result-types.ts                # RecordResult, IntentResult, BatchResult
│   │
│   ├── intents/
│   │   ├── record.ts                      # record() overloaded helper
│   │   ├── project.ts                     # project() overloaded helper
│   │   ├── accumulate.ts                  # accumulate() helper
│   │   ├── s3-put.ts                      # s3Put() helper
│   │   ├── skip.ts                        # skip() helper
│   │   ├── __tests__/
│   │   │   └── intents.test.ts            # All intent helper tests
│   │   └── index.ts                       # Re-export all helpers
│   │
│   ├── util/
│   │   ├── async-pool.ts                  # p-limit based asyncPool()
│   │   ├── group-by.ts                    # groupBy() with overloaded pick
│   │   ├── fork-merge.ts                  # forkMerge() parallel branches
│   │   ├── csv-serializer.ts              # Array → CSV string
│   │   ├── __tests__/
│   │   │   ├── async-pool.test.ts
│   │   │   ├── group-by.test.ts
│   │   │   ├── fork-merge.test.ts
│   │   │   └── csv-serializer.test.ts
│   │   └── index.ts
│   │
│   ├── engine/
│   │   ├── normalize-handler.ts           # HandlerEntry → canonical async fn
│   │   ├── intent-executor.ts             # WriteIntent + EventContext → AWS SDK calls
│   │   ├── error-collector.ts             # Per-record error collection + classification
│   │   ├── batch-engine.ts                # SQS batch processing loop
│   │   ├── stream-engine.ts               # DDB Stream processing loop
│   │   ├── __tests__/
│   │   │   ├── normalize-handler.test.ts
│   │   │   ├── intent-executor.test.ts
│   │   │   ├── error-collector.test.ts
│   │   │   ├── batch-engine.test.ts
│   │   │   └── stream-engine.test.ts
│   │   └── index.ts
│   │
│   ├── pipelines/
│   │   ├── create-event-handler.ts        # Universal SQS factory
│   │   ├── materialize-to-table.ts        # SQS → DDB preset
│   │   ├── materialize-to-bucket.ts       # SQS → S3 preset
│   │   ├── create-stream-handler.ts       # Universal DDB Stream factory
│   │   ├── change-data-capture.ts         # DDB Stream → EventBridge preset
│   │   ├── replay-and-reduce.ts           # DDB Stream → snapshot preset
│   │   ├── __tests__/
│   │   │   ├── create-event-handler.test.ts
│   │   │   ├── materialize-to-table.test.ts
│   │   │   ├── materialize-to-bucket.test.ts
│   │   │   ├── create-stream-handler.test.ts
│   │   │   ├── change-data-capture.test.ts
│   │   │   └── replay-and-reduce.test.ts
│   │   └── index.ts
│   │
│   └── testing/
│       ├── test-harness.ts                # createTestHarness()
│       ├── fake-records.ts                # fakeSqsRecord(), fakeDdbStreamRecord()
│       ├── __tests__/
│       │   └── test-harness.test.ts
│       └── index.ts
```

---

## Chunk 1: Scaffolding + Types + Intent Helpers

### Task 1: Scaffold the library

**Files:**
- Create: `libs/event-processor/project.json`
- Create: `libs/event-processor/tsconfig.json`
- Create: `libs/event-processor/tsconfig.lib.json`
- Create: `libs/event-processor/tsconfig.spec.json`
- Create: `libs/event-processor/jest.config.js`
- Create: `libs/event-processor/src/index.ts`
- Modify: `tsconfig.base.json` (add path aliases)

- [ ] **Step 1: Create project.json**

```json
{
  "name": "event-processor",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "libs/event-processor/src",
  "projectType": "library",
  "targets": {
    "build": {
      "executor": "@nx/js:tsc",
      "outputs": ["{options.outputPath}"],
      "options": {
        "outputPath": "dist/libs/event-processor",
        "tsConfig": "libs/event-processor/tsconfig.lib.json",
        "main": "libs/event-processor/src/index.ts",
        "assets": []
      }
    },
    "test": {
      "executor": "@nx/jest:jest",
      "outputs": ["{workspaceRoot}/coverage/libs/event-processor"],
      "options": {
        "jestConfig": "libs/event-processor/jest.config.js",
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

- [ ] **Step 2: Create tsconfig.json**

```json
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

- [ ] **Step 3: Create tsconfig.lib.json**

```json
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

- [ ] **Step 4: Create tsconfig.spec.json**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "../../dist/out-tsc",
    "module": "commonjs",
    "types": ["jest", "node"]
  },
  "include": [
    "jest.config.ts",
    "jest.config.js",
    "src/**/*.test.ts",
    "src/**/*.spec.ts",
    "src/**/*.ts",
    "test/**/*.ts"
  ]
}
```

- [ ] **Step 5: Create jest.config.js**

```javascript
const preset = require('../../jest.preset');

module.exports = {
  ...preset,
  displayName: 'event-processor',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@nestfolio/lambda-utils$': '<rootDir>/../lambda-utils/src/index.ts',
    '^@nestfolio/lambda-utils/(.*)$': '<rootDir>/../lambda-utils/src/$1',
    '^@nestfolio/platform-core$': '<rootDir>/../platform-core/src/index.ts',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: '<rootDir>/tsconfig.spec.json',
      diagnostics: false,
    }],
  },
  // p-limit is pure ESM — must be transformed by ts-jest
  transformIgnorePatterns: ['node_modules/(?!.*p-limit|.*yocto-queue)'],
};
```

- [ ] **Step 6: Create placeholder src/index.ts**

```typescript
// @nestfolio/event-processor — public API
// Types
export type { WriteIntent, RecordIntent, ProjectIntent, AccumulateIntent, S3PutIntent, SkipIntent, KeyOverrides } from './types/write-intent';
export type { HandlerFn, HandlerEntry, EventPayload } from './types/handler-config';
export type { EventContext } from './types/event-context';
export type { StreamRecord, StreamContext } from './types/stream-types';
```

- [ ] **Step 7: Add path aliases to tsconfig.base.json**

Add to the `paths` object:
```json
"@nestfolio/event-processor": ["libs/event-processor/src/index.ts"],
"@nestfolio/event-processor/*": ["libs/event-processor/src/*"]
```

- [ ] **Step 8: Install p-limit**

Run: `pnpm add p-limit yocto-queue -w`

Note: p-limit v6+ is pure ESM. The `transformIgnorePatterns` in jest.config.js handles this for testing. esbuild (CDK bundler) handles it natively for production.

- [ ] **Step 9: Verify scaffolding compiles**

Run: `npx nx test event-processor --skip-nx-cache`
Expected: PASS (no tests yet, passWithNoTests: true)

- [ ] **Step 10: Commit**

```bash
git add libs/event-processor/ tsconfig.base.json package.json pnpm-lock.yaml
git commit -m "chore: scaffold @nestfolio/event-processor library"
```

---

### Task 2: Core types

**Files:**
- Create: `libs/event-processor/src/types/write-intent.ts`
- Create: `libs/event-processor/src/types/handler-config.ts`
- Create: `libs/event-processor/src/types/event-context.ts`
- Create: `libs/event-processor/src/types/stream-types.ts`
- Create: `libs/event-processor/src/types/result-types.ts`

- [ ] **Step 1: Create write-intent.ts**

```typescript
export interface KeyOverrides {
  readonly pk?: string;
  readonly sk?: string;
}

export interface RecordIntent {
  readonly _tag: 'record';
  readonly typename: string;
  readonly fields: Record<string, unknown>;
  readonly overrides?: KeyOverrides;
}

export interface ProjectIntent {
  readonly _tag: 'project';
  readonly typename: string;
  readonly fields: Record<string, unknown>;
  readonly overrides?: KeyOverrides;
}

export interface AccumulateIntent {
  readonly _tag: 'accumulate';
  readonly typename: string;
  readonly field: string;
  readonly increment: number;
  readonly ttl?: number;
  readonly overrides?: KeyOverrides;
}

export interface S3PutIntent {
  readonly _tag: 's3-put';
  readonly body: unknown;
  readonly format: 'json' | 'csv';
  readonly key?: string;
}

export interface SkipIntent {
  readonly _tag: 'skip';
}

export type WriteIntent = RecordIntent | ProjectIntent | AccumulateIntent | S3PutIntent | SkipIntent;
```

- [ ] **Step 2: Create handler-config.ts**

```typescript
import type { EventContext } from './event-context';
import type { WriteIntent } from './write-intent';

export interface EventPayload {
  readonly subject: Record<string, unknown>;
  readonly context?: Record<string, unknown>;
}

export type HandlerFn = (
  payload: EventPayload,
  ctx: EventContext,
) => WriteIntent | WriteIntent[] | Promise<WriteIntent | WriteIntent[]>;

/**
 * A handler entry is either:
 * - A single HandlerFn (most common)
 * - An array of HandlerFn | WriteIntent (multi-write, results merged)
 */
export type HandlerEntry = HandlerFn | Array<HandlerFn | WriteIntent>;
```

- [ ] **Step 3: Create event-context.ts**

```typescript
import type { SQSRecord } from 'aws-lambda';

export interface EventContext {
  readonly eventId: string;
  readonly eventType: string;
  readonly tenantId: string;
  readonly userId?: string;
  readonly timestamp: string;
  readonly receiveCount: number;
  readonly serviceName: string;
  readonly record: SQSRecord;
}
```

- [ ] **Step 4: Create stream-types.ts**

```typescript
import type { DynamoDBRecord } from 'aws-lambda';

export interface StreamRecord {
  readonly pk: string;
  readonly sk: string;
  readonly __typename: string;
  readonly tenantId: string;
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
  readonly newImage?: Record<string, unknown>;
  readonly oldImage?: Record<string, unknown>;
}
```

- [ ] **Step 5: Create result-types.ts**

```typescript
export type RecordOutcome = 'success' | 'deduplicated' | 'error' | 'poison-pill' | 'skipped';

export interface RecordResult {
  readonly messageId: string;
  readonly outcome: RecordOutcome;
  readonly error?: Error;
  readonly retryable?: boolean;
}

export interface IntentResult {
  readonly _tag: string;
  readonly success: boolean;
  readonly deduplicated?: boolean;
}

export interface BatchResult {
  readonly results: RecordResult[];
  readonly metrics: Record<string, number>;
  readonly batchItemFailures: string[];
}
```

- [ ] **Step 6: Verify types compile**

Run: `npx nx build event-processor --skip-nx-cache`
Expected: BUILD SUCCESS

- [ ] **Step 7: Commit**

```bash
git add libs/event-processor/src/types/
git commit -m "feat(event-processor): add core types (WriteIntent, EventContext, HandlerConfig)"
```

---

### Task 3: Intent helpers — record, project, accumulate, s3Put, skip

**Files:**
- Create: `libs/event-processor/src/intents/record.ts`
- Create: `libs/event-processor/src/intents/project.ts`
- Create: `libs/event-processor/src/intents/accumulate.ts`
- Create: `libs/event-processor/src/intents/s3-put.ts`
- Create: `libs/event-processor/src/intents/skip.ts`
- Create: `libs/event-processor/src/intents/index.ts`
- Create: `libs/event-processor/src/intents/__tests__/intents.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// libs/event-processor/src/intents/__tests__/intents.test.ts
import { record } from '../record';
import { project } from '../project';
import { accumulate } from '../accumulate';
import { s3Put } from '../s3-put';
import { skip } from '../skip';
import type { EventPayload } from '../../types/handler-config';
import type { EventContext } from '../../types/event-context';

const fakeCtx = { eventId: 'e1', eventType: 'TEST', tenantId: 't1', timestamp: '2026-01-01T00:00:00Z', receiveCount: 1, serviceName: 'test' } as EventContext;

describe('record()', () => {
  it('inline mode returns RecordIntent data', () => {
    const intent = record('LedgerEntry', { amount: 100 });
    expect(intent).toEqual({ _tag: 'record', typename: 'LedgerEntry', fields: { amount: 100 }, overrides: undefined });
  });

  it('inline mode with overrides', () => {
    const intent = record('LedgerEntry', { amount: 100 }, { pk: 'custom' });
    expect(intent).toEqual({ _tag: 'record', typename: 'LedgerEntry', fields: { amount: 100 }, overrides: { pk: 'custom' } });
  });

  it('mapper mode returns HandlerFn', () => {
    const fn = record('LedgerEntry', ({ subject }) => ({ amount: subject.amount }));
    expect(typeof fn).toBe('function');
  });

  it('mapper mode HandlerFn returns RecordIntent when called', async () => {
    const fn = record('LedgerEntry', ({ subject }) => ({ amount: subject.amount }));
    const payload: EventPayload = { subject: { amount: 500 } };
    const result = await (fn as Function)(payload, fakeCtx);
    expect(result).toEqual({ _tag: 'record', typename: 'LedgerEntry', fields: { amount: 500 }, overrides: undefined });
  });

  it('mapper mode with overrides', async () => {
    const fn = record('LedgerEntry', ({ subject }) => ({ amount: subject.amount }), { sk: 'custom-sk' });
    const payload: EventPayload = { subject: { amount: 500 } };
    const result = await (fn as Function)(payload, fakeCtx);
    expect(result).toEqual({ _tag: 'record', typename: 'LedgerEntry', fields: { amount: 500 }, overrides: { sk: 'custom-sk' } });
  });
});

describe('project()', () => {
  it('inline mode returns ProjectIntent data', () => {
    const intent = project('Summary', { total: 42 });
    expect(intent).toEqual({ _tag: 'project', typename: 'Summary', fields: { total: 42 }, overrides: undefined });
  });

  it('mapper mode returns HandlerFn that produces ProjectIntent', async () => {
    const fn = project('Summary', ({ subject }) => ({ total: subject.total }));
    const result = await (fn as Function)({ subject: { total: 42 } }, fakeCtx);
    expect(result).toEqual({ _tag: 'project', typename: 'Summary', fields: { total: 42 }, overrides: undefined });
  });
});

describe('accumulate()', () => {
  it('returns AccumulateIntent data', () => {
    const intent = accumulate('Stats', { field: 'count', increment: 1 });
    expect(intent).toEqual({ _tag: 'accumulate', typename: 'Stats', field: 'count', increment: 1, ttl: undefined, overrides: undefined });
  });

  it('with ttl and overrides', () => {
    const intent = accumulate('Balance', { field: 'amount', increment: -50, ttl: 604800, overrides: { pk: 'A#1' } });
    expect(intent).toEqual({ _tag: 'accumulate', typename: 'Balance', field: 'amount', increment: -50, ttl: 604800, overrides: { pk: 'A#1' } });
  });
});

describe('s3Put()', () => {
  it('returns S3PutIntent with defaults', () => {
    const intent = s3Put({ data: 1 });
    expect(intent).toEqual({ _tag: 's3-put', body: { data: 1 }, format: 'json', key: undefined });
  });

  it('with format and key override', () => {
    const intent = s3Put([{ a: 1 }], { format: 'csv', key: 'exports/data.csv' });
    expect(intent).toEqual({ _tag: 's3-put', body: [{ a: 1 }], format: 'csv', key: 'exports/data.csv' });
  });
});

describe('skip()', () => {
  it('returns SkipIntent', () => {
    expect(skip()).toEqual({ _tag: 'skip' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx nx test event-processor --skip-nx-cache`
Expected: FAIL (modules not found)

- [ ] **Step 3: Implement record.ts**

```typescript
import type { RecordIntent, KeyOverrides } from '../types/write-intent';
import type { HandlerFn, EventPayload } from '../types/handler-config';
import type { EventContext } from '../types/event-context';

export function record(typename: string, fieldsOrMapper: Record<string, unknown>, overrides?: KeyOverrides): RecordIntent;
export function record(typename: string, fieldsOrMapper: (payload: EventPayload, ctx: EventContext) => Record<string, unknown>, overrides?: KeyOverrides): HandlerFn;
export function record(
  typename: string,
  fieldsOrMapper: Record<string, unknown> | ((payload: EventPayload, ctx: EventContext) => Record<string, unknown>),
  overrides?: KeyOverrides,
): RecordIntent | HandlerFn {
  if (typeof fieldsOrMapper === 'function') {
    return (payload: EventPayload, ctx: EventContext) => ({
      _tag: 'record' as const,
      typename,
      fields: fieldsOrMapper(payload, ctx),
      overrides,
    });
  }
  return { _tag: 'record', typename, fields: fieldsOrMapper, overrides };
}
```

- [ ] **Step 4: Implement project.ts**

```typescript
import type { ProjectIntent, KeyOverrides } from '../types/write-intent';
import type { HandlerFn, EventPayload } from '../types/handler-config';
import type { EventContext } from '../types/event-context';

export function project(typename: string, fieldsOrMapper: Record<string, unknown>, overrides?: KeyOverrides): ProjectIntent;
export function project(typename: string, fieldsOrMapper: (payload: EventPayload, ctx: EventContext) => Record<string, unknown>, overrides?: KeyOverrides): HandlerFn;
export function project(
  typename: string,
  fieldsOrMapper: Record<string, unknown> | ((payload: EventPayload, ctx: EventContext) => Record<string, unknown>),
  overrides?: KeyOverrides,
): ProjectIntent | HandlerFn {
  if (typeof fieldsOrMapper === 'function') {
    return (payload: EventPayload, ctx: EventContext) => ({
      _tag: 'project' as const,
      typename,
      fields: fieldsOrMapper(payload, ctx),
      overrides,
    });
  }
  return { _tag: 'project', typename, fields: fieldsOrMapper, overrides };
}
```

- [ ] **Step 5: Implement accumulate.ts**

```typescript
import type { AccumulateIntent, KeyOverrides } from '../types/write-intent';

interface AccumulateConfig {
  field: string;
  increment: number;
  ttl?: number;
  overrides?: KeyOverrides;
}

export function accumulate(typename: string, config: AccumulateConfig): AccumulateIntent {
  return {
    _tag: 'accumulate',
    typename,
    field: config.field,
    increment: config.increment,
    ttl: config.ttl,
    overrides: config.overrides,
  };
}
```

- [ ] **Step 6: Implement s3-put.ts**

```typescript
import type { S3PutIntent } from '../types/write-intent';

export function s3Put(body: unknown, opts?: { format?: 'json' | 'csv'; key?: string }): S3PutIntent {
  return {
    _tag: 's3-put',
    body,
    format: opts?.format ?? 'json',
    key: opts?.key,
  };
}
```

- [ ] **Step 7: Implement skip.ts**

```typescript
import type { SkipIntent } from '../types/write-intent';

export function skip(): SkipIntent {
  return { _tag: 'skip' };
}
```

- [ ] **Step 8: Create intents/index.ts**

```typescript
export { record } from './record';
export { project } from './project';
export { accumulate } from './accumulate';
export { s3Put } from './s3-put';
export { skip } from './skip';
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npx nx test event-processor --skip-nx-cache`
Expected: PASS (17 tests)

- [ ] **Step 10: Commit**

```bash
git add libs/event-processor/src/intents/
git commit -m "feat(event-processor): add intent helpers (record, project, accumulate, s3Put, skip)"
```

---

## Chunk 2: Concurrency Utilities

### Task 4: asyncPool

**Files:**
- Create: `libs/event-processor/src/util/async-pool.ts`
- Create: `libs/event-processor/src/util/__tests__/async-pool.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// libs/event-processor/src/util/__tests__/async-pool.test.ts
import { asyncPool } from '../async-pool';

describe('asyncPool()', () => {
  it('processes all items and returns results in order', async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await asyncPool(items, async (n) => n * 2);
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it('limits concurrency', async () => {
    let active = 0;
    let maxActive = 0;
    const items = [1, 2, 3, 4, 5, 6];

    await asyncPool(items, async (n) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return n;
    }, { concurrency: 2 });

    expect(maxActive).toBe(2);
  });

  it('defaults to concurrency 5', async () => {
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);

    await asyncPool(items, async (n) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n;
    });

    expect(maxActive).toBe(5);
  });

  it('handles empty array', async () => {
    const results = await asyncPool([], async (n: number) => n);
    expect(results).toEqual([]);
  });

  it('propagates errors', async () => {
    await expect(
      asyncPool([1, 2, 3], async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx nx test event-processor --testPathPattern=async-pool --skip-nx-cache`
Expected: FAIL

- [ ] **Step 3: Implement async-pool.ts**

```typescript
import pLimit from 'p-limit';

const DEFAULT_CONCURRENCY = 5;

export async function asyncPool<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  opts?: { concurrency?: number },
): Promise<R[]> {
  const limit = pLimit(opts?.concurrency ?? DEFAULT_CONCURRENCY);
  return Promise.all(items.map((item) => limit(() => fn(item))));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx nx test event-processor --testPathPattern=async-pool --skip-nx-cache`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add libs/event-processor/src/util/async-pool.ts libs/event-processor/src/util/__tests__/async-pool.test.ts
git commit -m "feat(event-processor): add asyncPool utility with p-limit concurrency"
```

---

### Task 5: groupBy

**Files:**
- Create: `libs/event-processor/src/util/group-by.ts`
- Create: `libs/event-processor/src/util/__tests__/group-by.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// libs/event-processor/src/util/__tests__/group-by.test.ts
import { groupBy } from '../group-by';

describe('groupBy()', () => {
  const items = [
    { tenantId: 'A', id: '1', value: 10 },
    { tenantId: 'B', id: '2', value: 20 },
    { tenantId: 'A', id: '3', value: 30 },
    { tenantId: 'B', id: '4', value: 40 },
    { tenantId: 'A', id: '5', value: 50 },
  ];

  it('groups all items by default (pick: all)', () => {
    const result = groupBy(items, { key: (i) => i.tenantId });
    expect(result.get('A')).toHaveLength(3);
    expect(result.get('B')).toHaveLength(2);
  });

  it('pick: first returns first item per group', () => {
    const result = groupBy(items, { key: (i) => i.tenantId, pick: 'first' });
    expect(result.get('A')).toEqual({ tenantId: 'A', id: '1', value: 10 });
    expect(result.get('B')).toEqual({ tenantId: 'B', id: '2', value: 20 });
  });

  it('pick: last returns last item per group', () => {
    const result = groupBy(items, { key: (i) => i.tenantId, pick: 'last' });
    expect(result.get('A')).toEqual({ tenantId: 'A', id: '5', value: 50 });
    expect(result.get('B')).toEqual({ tenantId: 'B', id: '4', value: 40 });
  });

  it('handles empty array', () => {
    const result = groupBy([], { key: () => 'x' });
    expect(result.size).toBe(0);
  });

  it('single-item groups', () => {
    const result = groupBy(items, { key: (i) => i.id, pick: 'last' });
    expect(result.size).toBe(5);
    expect(result.get('1')).toEqual({ tenantId: 'A', id: '1', value: 10 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx nx test event-processor --testPathPattern=group-by --skip-nx-cache`
Expected: FAIL

- [ ] **Step 3: Implement group-by.ts**

```typescript
interface GroupByAll<T> { key: (item: T) => string; pick?: 'all' }
interface GroupByPick<T> { key: (item: T) => string; pick: 'first' | 'last' }

export function groupBy<T>(items: T[], config: GroupByPick<T>): Map<string, T>;
export function groupBy<T>(items: T[], config: GroupByAll<T>): Map<string, T[]>;
export function groupBy<T>(
  items: T[],
  config: { key: (item: T) => string; pick?: 'first' | 'last' | 'all' },
): Map<string, T | T[]> {
  const pick = config.pick ?? 'all';

  if (pick === 'all') {
    const map = new Map<string, T[]>();
    for (const item of items) {
      const k = config.key(item);
      const arr = map.get(k);
      if (arr) arr.push(item);
      else map.set(k, [item]);
    }
    return map;
  }

  const map = new Map<string, T>();
  if (pick === 'first') {
    for (const item of items) {
      const k = config.key(item);
      if (!map.has(k)) map.set(k, item);
    }
  } else {
    for (const item of items) {
      map.set(config.key(item), item);
    }
  }
  return map;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx nx test event-processor --testPathPattern=group-by --skip-nx-cache`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add libs/event-processor/src/util/group-by.ts libs/event-processor/src/util/__tests__/group-by.test.ts
git commit -m "feat(event-processor): add groupBy utility with type-safe pick overloads"
```

---

### Task 6: forkMerge

**Files:**
- Create: `libs/event-processor/src/util/fork-merge.ts`
- Create: `libs/event-processor/src/util/__tests__/fork-merge.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// libs/event-processor/src/util/__tests__/fork-merge.test.ts
import { forkMerge } from '../fork-merge';

describe('forkMerge()', () => {
  const items = [
    { type: 'A', value: 1 },
    { type: 'B', value: 2 },
    { type: 'A', value: 3 },
    { type: 'B', value: 4 },
  ];

  it('routes items to matching branches', async () => {
    const results = await forkMerge(items, [
      { filter: (i) => i.type === 'A', process: async (i) => i.value * 10 },
      { filter: (i) => i.type === 'B', process: async (i) => i.value * 100 },
    ]);

    expect(results[0].results).toEqual([10, 30]);
    expect(results[1].results).toEqual([200, 400]);
  });

  it('collects errors per branch without stopping others', async () => {
    const results = await forkMerge(items, [
      { filter: (i) => i.type === 'A', process: async (i) => {
        if (i.value === 3) throw new Error('boom');
        return i.value;
      }},
      { filter: (i) => i.type === 'B', process: async (i) => i.value },
    ]);

    expect(results[0].results).toEqual([1]);
    expect(results[0].errors).toHaveLength(1);
    expect(results[0].errors[0].error.message).toBe('boom');
    expect(results[1].results).toEqual([2, 4]);
    expect(results[1].errors).toHaveLength(0);
  });

  it('respects per-branch concurrency', async () => {
    let active = 0;
    let maxActive = 0;

    await forkMerge(
      Array.from({ length: 10 }, (_, i) => ({ type: 'A', value: i })),
      [{
        filter: () => true,
        concurrency: 2,
        process: async (i) => {
          active++;
          maxActive = Math.max(maxActive, active);
          await new Promise((r) => setTimeout(r, 10));
          active--;
          return i.value;
        },
      }],
    );

    expect(maxActive).toBe(2);
  });

  it('handles empty items', async () => {
    const results = await forkMerge([], [
      { filter: () => true, process: async (i: any) => i },
    ]);
    expect(results[0].results).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx nx test event-processor --testPathPattern=fork-merge --skip-nx-cache`
Expected: FAIL

- [ ] **Step 3: Implement fork-merge.ts**

```typescript
import { asyncPool } from './async-pool';

const DEFAULT_CONCURRENCY = 5;

export interface Branch<T, R> {
  filter: (item: T) => boolean;
  process: (item: T) => Promise<R>;
  concurrency?: number;
}

export interface BranchResult<R> {
  results: R[];
  errors: Array<{ item: unknown; error: Error }>;
}

export async function forkMerge<T, R>(
  items: T[],
  branches: Branch<T, R>[],
): Promise<BranchResult<R>[]> {
  const branchPromises = branches.map(async (branch): Promise<BranchResult<R>> => {
    const filtered = items.filter(branch.filter);
    const results: R[] = [];
    const errors: Array<{ item: unknown; error: Error }> = [];

    await asyncPool(
      filtered,
      async (item) => {
        try {
          results.push(await branch.process(item));
        } catch (err) {
          errors.push({ item, error: err instanceof Error ? err : new Error(String(err)) });
        }
      },
      { concurrency: branch.concurrency ?? DEFAULT_CONCURRENCY },
    );

    return { results, errors };
  });

  return Promise.all(branchPromises);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx nx test event-processor --testPathPattern=fork-merge --skip-nx-cache`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add libs/event-processor/src/util/fork-merge.ts libs/event-processor/src/util/__tests__/fork-merge.test.ts
git commit -m "feat(event-processor): add forkMerge utility for parallel branch execution"
```

---

### Task 7: csvSerializer

**Files:**
- Create: `libs/event-processor/src/util/csv-serializer.ts`
- Create: `libs/event-processor/src/util/__tests__/csv-serializer.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// libs/event-processor/src/util/__tests__/csv-serializer.test.ts
import { toCsv } from '../csv-serializer';

describe('toCsv()', () => {
  it('serializes array of objects to CSV with headers', () => {
    const data = [
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
    ];
    const csv = toCsv(data);
    expect(csv).toBe('name,age\nAlice,30\nBob,25');
  });

  it('escapes commas in values', () => {
    const data = [{ name: 'Doe, John', age: 40 }];
    expect(toCsv(data)).toBe('name,age\n"Doe, John",40');
  });

  it('escapes double quotes in values', () => {
    const data = [{ desc: 'He said "hi"' }];
    expect(toCsv(data)).toBe('desc\n"He said ""hi"""');
  });

  it('handles empty array', () => {
    expect(toCsv([])).toBe('');
  });

  it('handles null/undefined values', () => {
    const data = [{ a: null, b: undefined, c: 0 }];
    expect(toCsv(data)).toBe('a,b,c\n,,0');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx nx test event-processor --testPathPattern=csv-serializer --skip-nx-cache`
Expected: FAIL

- [ ] **Step 3: Implement csv-serializer.ts**

```typescript
function escapeField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsv(data: Record<string, unknown>[]): string {
  if (data.length === 0) return '';
  const headers = Object.keys(data[0]);
  const headerLine = headers.join(',');
  const rows = data.map((row) => headers.map((h) => escapeField(row[h])).join(','));
  return [headerLine, ...rows].join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx nx test event-processor --testPathPattern=csv-serializer --skip-nx-cache`
Expected: PASS (5 tests)

- [ ] **Step 5: Create util/index.ts**

```typescript
export { asyncPool } from './async-pool';
export { groupBy } from './group-by';
export { forkMerge } from './fork-merge';
export type { Branch, BranchResult } from './fork-merge';
export { toCsv } from './csv-serializer';
```

- [ ] **Step 6: Commit**

```bash
git add libs/event-processor/src/util/
git commit -m "feat(event-processor): add csvSerializer utility and util barrel export"
```

---

## Chunk 3: Engine Core

### Task 8: normalizeHandler

**Files:**
- Create: `libs/event-processor/src/engine/normalize-handler.ts`
- Create: `libs/event-processor/src/engine/__tests__/normalize-handler.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// libs/event-processor/src/engine/__tests__/normalize-handler.test.ts
import { normalizeHandler } from '../normalize-handler';
import { record } from '../../intents/record';
import { accumulate } from '../../intents/accumulate';
import type { EventPayload } from '../../types/handler-config';
import type { EventContext } from '../../types/event-context';

const fakePayload: EventPayload = { subject: { amount: 100 } };
const fakeCtx = { eventId: 'e1', eventType: 'TEST', tenantId: 't1', timestamp: '2026-01-01T00:00:00Z', receiveCount: 1, serviceName: 'test' } as EventContext;

describe('normalizeHandler()', () => {
  it('normalizes a HandlerFn (mapper mode record)', async () => {
    const handler = record('Entry', ({ subject }) => ({ amount: subject.amount }));
    const fn = normalizeHandler(handler);
    const result = await fn(fakePayload, fakeCtx);
    expect(result).toEqual([{ _tag: 'record', typename: 'Entry', fields: { amount: 100 }, overrides: undefined }]);
  });

  it('normalizes an async HandlerFn returning array', async () => {
    const handler = async ({ subject }: EventPayload) => [
      record('Entry', { amount: subject.amount }),
      accumulate('Stats', { field: 'count', increment: 1 }),
    ];
    const fn = normalizeHandler(handler);
    const result = await fn(fakePayload, fakeCtx);
    expect(result).toHaveLength(2);
    expect(result[0]._tag).toBe('record');
    expect(result[1]._tag).toBe('accumulate');
  });

  it('normalizes a HandlerEntry array (mixed HandlerFn + WriteIntent)', async () => {
    const entry = [
      record('Activity', ({ subject }) => ({ desc: String(subject.amount) })),
      accumulate('Stats', { field: 'count', increment: 1 }),
    ];
    const fn = normalizeHandler(entry);
    const result = await fn(fakePayload, fakeCtx);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(expect.objectContaining({ _tag: 'record', typename: 'Activity' }));
    expect(result[1]).toEqual(expect.objectContaining({ _tag: 'accumulate', typename: 'Stats' }));
  });

  it('wraps a single WriteIntent in an array', async () => {
    const handler = async () => record('Entry', { x: 1 });
    const fn = normalizeHandler(handler);
    const result = await fn(fakePayload, fakeCtx);
    expect(result).toEqual([{ _tag: 'record', typename: 'Entry', fields: { x: 1 }, overrides: undefined }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx nx test event-processor --testPathPattern=normalize-handler --skip-nx-cache`
Expected: FAIL

- [ ] **Step 3: Implement normalize-handler.ts**

```typescript
import type { WriteIntent } from '../types/write-intent';
import type { HandlerEntry, HandlerFn, EventPayload } from '../types/handler-config';
import type { EventContext } from '../types/event-context';

type NormalizedHandler = (payload: EventPayload, ctx: EventContext) => Promise<WriteIntent[]>;

function isWriteIntent(value: unknown): value is WriteIntent {
  return typeof value === 'object' && value !== null && '_tag' in value;
}

function toArray(result: WriteIntent | WriteIntent[]): WriteIntent[] {
  return Array.isArray(result) ? result : [result];
}

export function normalizeHandler(entry: HandlerEntry): NormalizedHandler {
  // Array of HandlerFn | WriteIntent
  if (Array.isArray(entry)) {
    return async (payload, ctx) => {
      const intents: WriteIntent[] = [];
      for (const item of entry) {
        if (typeof item === 'function') {
          const result = await item(payload, ctx);
          intents.push(...toArray(result));
        } else if (isWriteIntent(item)) {
          intents.push(item);
        }
      }
      return intents;
    };
  }

  // Single HandlerFn
  return async (payload, ctx) => {
    const result = await entry(payload, ctx);
    return toArray(result);
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx nx test event-processor --testPathPattern=normalize-handler --skip-nx-cache`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add libs/event-processor/src/engine/normalize-handler.ts libs/event-processor/src/engine/__tests__/normalize-handler.test.ts
git commit -m "feat(event-processor): add normalizeHandler for HandlerEntry → canonical async fn"
```

---

### Task 9: errorCollector

**Files:**
- Create: `libs/event-processor/src/engine/error-collector.ts`
- Create: `libs/event-processor/src/engine/__tests__/error-collector.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// libs/event-processor/src/engine/__tests__/error-collector.test.ts
import { ErrorCollector } from '../error-collector';
import { NotRetryableError } from '@nestfolio/lambda-utils';

describe('ErrorCollector', () => {
  let collector: ErrorCollector;

  beforeEach(() => {
    collector = new ErrorCollector();
  });

  it('starts empty', () => {
    expect(collector.getResults().batchItemFailures).toEqual([]);
    expect(collector.getResults().metrics.EventProcessed).toBe(0);
  });

  it('collects successful records', () => {
    collector.recordSuccess('msg-1', 'ORDER_FILLED');
    collector.recordSuccess('msg-2', 'DEPOSIT_DETECTED');
    const r = collector.getResults();
    expect(r.metrics.EventProcessed).toBe(2);
    expect(r.batchItemFailures).toEqual([]);
  });

  it('collects deduplicated records', () => {
    collector.recordDeduplicated('msg-1', 'ORDER_FILLED');
    const r = collector.getResults();
    expect(r.metrics.EventDeduplicated).toBe(1);
    expect(r.metrics.EventProcessed).toBe(0);
    expect(r.batchItemFailures).toEqual([]);
  });

  it('collects retryable errors → batchItemFailures', () => {
    collector.recordError('msg-1', 'ORDER_FILLED', new Error('timeout'), true);
    const r = collector.getResults();
    expect(r.metrics.EventFailed).toBe(1);
    expect(r.batchItemFailures).toEqual(['msg-1']);
  });

  it('collects non-retryable errors → dropped, NOT in failures', () => {
    collector.recordError('msg-1', 'ORDER_FILLED', new NotRetryableError('bad data'), false);
    const r = collector.getResults();
    expect(r.metrics.EventDropped).toBe(1);
    expect(r.batchItemFailures).toEqual([]);
    expect(r.droppedErrors).toHaveLength(1);
  });

  it('collects poison pills → NOT in failures', () => {
    collector.recordPoisonPill('msg-1');
    const r = collector.getResults();
    expect(r.metrics.PoisonPillDetected).toBe(1);
    expect(r.batchItemFailures).toEqual([]);
  });

  it('collects skipped records', () => {
    collector.recordSkipped('msg-1');
    const r = collector.getResults();
    expect(r.metrics.EventSkipped).toBe(1);
  });

  it('tracks BatchSize', () => {
    collector.recordSuccess('msg-1', 'A');
    collector.recordError('msg-2', 'B', new Error('x'), true);
    collector.recordDeduplicated('msg-3', 'C');
    const r = collector.getResults();
    expect(r.metrics.BatchSize).toBe(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx nx test event-processor --testPathPattern=error-collector --skip-nx-cache`
Expected: FAIL

- [ ] **Step 3: Implement error-collector.ts**

```typescript
export interface CollectorResults {
  metrics: Record<string, number>;
  batchItemFailures: string[];
  droppedErrors: Array<{ messageId: string; eventType: string; error: Error }>;
}

export class ErrorCollector {
  private readonly metrics: Record<string, number> = {
    EventProcessed: 0,
    EventFailed: 0,
    EventDeduplicated: 0,
    EventDropped: 0,
    PoisonPillDetected: 0,
    EventSkipped: 0,
    BatchSize: 0,
  };
  private readonly failures: string[] = [];
  private readonly dropped: Array<{ messageId: string; eventType: string; error: Error }> = [];

  recordSuccess(messageId: string, eventType: string): void {
    this.metrics.EventProcessed++;
    this.metrics.BatchSize++;
  }

  recordDeduplicated(messageId: string, eventType: string): void {
    this.metrics.EventDeduplicated++;
    this.metrics.BatchSize++;
  }

  recordError(messageId: string, eventType: string, error: Error, retryable: boolean): void {
    this.metrics.BatchSize++;
    if (retryable) {
      this.metrics.EventFailed++;
      this.failures.push(messageId);
    } else {
      this.metrics.EventDropped++;
      this.dropped.push({ messageId, eventType, error });
    }
  }

  recordPoisonPill(messageId: string): void {
    this.metrics.PoisonPillDetected++;
    this.metrics.BatchSize++;
  }

  recordSkipped(messageId: string): void {
    this.metrics.EventSkipped++;
    this.metrics.BatchSize++;
  }

  getResults(): CollectorResults {
    return {
      metrics: { ...this.metrics },
      batchItemFailures: [...this.failures],
      droppedErrors: [...this.dropped],
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx nx test event-processor --testPathPattern=error-collector --skip-nx-cache`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add libs/event-processor/src/engine/error-collector.ts libs/event-processor/src/engine/__tests__/error-collector.test.ts
git commit -m "feat(event-processor): add ErrorCollector for per-record error classification"
```

---

### Task 10: intentExecutor

**Files:**
- Create: `libs/event-processor/src/engine/intent-executor.ts`
- Create: `libs/event-processor/src/engine/__tests__/intent-executor.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// libs/event-processor/src/engine/__tests__/intent-executor.test.ts
import { IntentExecutor } from '../intent-executor';
import type { EventContext } from '../../types/event-context';
import type { RecordIntent, ProjectIntent, AccumulateIntent, SkipIntent } from '../../types/write-intent';

// Mock guardedWrite from lambda-utils
const mockGuardedWrite = jest.fn().mockResolvedValue(true);
jest.mock('@nestfolio/lambda-utils', () => ({
  guardedWrite: (...args: unknown[]) => mockGuardedWrite(...args),
  NotRetryableError: class NotRetryableError extends Error {},
}));

const fakeCtx: EventContext = {
  eventId: 'evt-1',
  eventType: 'ORDER_FILLED',
  tenantId: 'tenant-1',
  timestamp: '2026-01-01T00:00:00Z',
  receiveCount: 1,
  serviceName: 'test-svc',
} as EventContext;

describe('IntentExecutor', () => {
  let mockDocClient: any;
  let executor: IntentExecutor;

  beforeEach(() => {
    mockDocClient = {
      send: jest.fn().mockResolvedValue({}),
    };
    mockGuardedWrite.mockResolvedValue(true);
    executor = new IntentExecutor({ docClient: mockDocClient, tableName: 'TestTable' });
  });

  describe('record intent (putIfNotExists)', () => {
    const intent: RecordIntent = { _tag: 'record', typename: 'LedgerEntry', fields: { amount: 100 } };

    it('sends PutCommand with condition expression', async () => {
      const result = await executor.execute(intent, fakeCtx);
      expect(result.success).toBe(true);
      expect(mockDocClient.send).toHaveBeenCalledTimes(1);

      const cmd = mockDocClient.send.mock.calls[0][0].input;
      expect(cmd.TableName).toBe('TestTable');
      expect(cmd.Item.pk).toBe('T#tenant-1');
      expect(cmd.Item.sk).toBe('LedgerEntry#evt-1');
      expect(cmd.Item.__typename).toBe('LedgerEntry');
      expect(cmd.Item.amount).toBe(100);
      expect(cmd.ConditionExpression).toBe('attribute_not_exists(pk)');
    });

    it('returns deduplicated when ConditionalCheckFailedException', async () => {
      const err = new Error('cond');
      err.name = 'ConditionalCheckFailedException';
      mockDocClient.send.mockRejectedValueOnce(err);

      const result = await executor.execute(intent, fakeCtx);
      expect(result.success).toBe(true);
      expect(result.deduplicated).toBe(true);
    });

    it('uses key overrides when provided', async () => {
      const overridden: RecordIntent = { ...intent, overrides: { pk: 'Custom#1', sk: 'Custom#2' } };
      await executor.execute(overridden, fakeCtx);

      const cmd = mockDocClient.send.mock.calls[0][0].input;
      expect(cmd.Item.pk).toBe('Custom#1');
      expect(cmd.Item.sk).toBe('Custom#2');
    });
  });

  describe('project intent (upsert)', () => {
    const intent: ProjectIntent = { _tag: 'project', typename: 'Summary', fields: { total: 42 } };

    it('sends PutCommand without condition (upsert)', async () => {
      const result = await executor.execute(intent, fakeCtx);
      expect(result.success).toBe(true);

      const cmd = mockDocClient.send.mock.calls[0][0].input;
      expect(cmd.Item.pk).toBe('T#tenant-1');
      expect(cmd.Item.sk).toBe('Summary');
      expect(cmd.Item.total).toBe(42);
      expect(cmd.ConditionExpression).toBeUndefined();
    });
  });

  describe('accumulate intent (guardedWrite)', () => {
    const intent: AccumulateIntent = { _tag: 'accumulate', typename: 'Stats', field: 'count', increment: 1 };

    it('delegates to guardedWrite from lambda-utils', async () => {
      const result = await executor.execute(intent, fakeCtx);
      expect(result.success).toBe(true);
      expect(result.deduplicated).toBeFalsy();

      expect(mockGuardedWrite).toHaveBeenCalledWith(
        mockDocClient,
        'TestTable',
        { pk: 'T#tenant-1', sk: 'ProcessedEvent#evt-1' },
        expect.arrayContaining([
          expect.objectContaining({
            Update: expect.objectContaining({
              Key: { pk: 'T#tenant-1', sk: 'Stats' },
            }),
          }),
        ]),
        undefined, // default ttl
      );
    });

    it('returns deduplicated when guardedWrite returns false', async () => {
      mockGuardedWrite.mockResolvedValueOnce(false);

      const result = await executor.execute(intent, fakeCtx);
      expect(result.success).toBe(true);
      expect(result.deduplicated).toBe(true);
    });

    it('passes ttl override to guardedWrite', async () => {
      const withTtl: AccumulateIntent = { ...intent, ttl: 604800 };
      await executor.execute(withTtl, fakeCtx);

      expect(mockGuardedWrite).toHaveBeenCalledWith(
        mockDocClient, 'TestTable',
        expect.any(Object), expect.any(Array),
        604800,
      );
    });
  });

  describe('skip intent', () => {
    it('does nothing', async () => {
      const result = await executor.execute({ _tag: 'skip' } as SkipIntent, fakeCtx);
      expect(result.success).toBe(true);
      expect(mockDocClient.send).not.toHaveBeenCalled();
      expect(mockGuardedWrite).not.toHaveBeenCalled();
    });
  });

  describe('s3-put intent', () => {
    it('throws NotRetryableError (requires S3 executor)', async () => {
      await expect(
        executor.execute({ _tag: 's3-put', body: {}, format: 'json' }, fakeCtx),
      ).rejects.toThrow('S3 intents require an S3 executor');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx nx test event-processor --testPathPattern=intent-executor --skip-nx-cache`
Expected: FAIL

- [ ] **Step 3: Implement intent-executor.ts**

```typescript
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { guardedWrite, NotRetryableError } from '@nestfolio/lambda-utils';
import type { WriteIntent, RecordIntent, ProjectIntent, AccumulateIntent } from '../types/write-intent';
import type { EventContext } from '../types/event-context';
import type { IntentResult } from '../types/result-types';

interface ExecutorDeps {
  docClient: DynamoDBDocumentClient;
  tableName: string;
}

export class IntentExecutor {
  constructor(private readonly deps: ExecutorDeps) {}

  async execute(intent: WriteIntent, ctx: EventContext): Promise<IntentResult> {
    switch (intent._tag) {
      case 'record':    return this.executeRecord(intent, ctx);
      case 'project':   return this.executeProject(intent, ctx);
      case 'accumulate': return this.executeAccumulate(intent, ctx);
      case 'skip':      return { _tag: 'skip', success: true };
      case 's3-put':    throw new NotRetryableError('S3 intents require an S3 executor — use materializeToBucket pipeline');
      default:          return { _tag: 'unknown', success: false };
    }
  }

  private async executeRecord(intent: RecordIntent, ctx: EventContext): Promise<IntentResult> {
    const pk = intent.overrides?.pk ?? `T#${ctx.tenantId}`;
    const sk = intent.overrides?.sk ?? `${intent.typename}#${ctx.eventId}`;

    try {
      await this.deps.docClient.send(new PutCommand({
        TableName: this.deps.tableName,
        Item: { pk, sk, __typename: intent.typename, ...intent.fields, eventId: ctx.eventId, createdAt: ctx.timestamp },
        ConditionExpression: 'attribute_not_exists(pk)',
      }));
      return { _tag: 'record', success: true };
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        return { _tag: 'record', success: true, deduplicated: true };
      }
      throw error;
    }
  }

  private async executeProject(intent: ProjectIntent, ctx: EventContext): Promise<IntentResult> {
    const pk = intent.overrides?.pk ?? `T#${ctx.tenantId}`;
    const sk = intent.overrides?.sk ?? intent.typename;

    await this.deps.docClient.send(new PutCommand({
      TableName: this.deps.tableName,
      Item: { pk, sk, __typename: intent.typename, ...intent.fields, updatedAt: ctx.timestamp },
    }));
    return { _tag: 'project', success: true };
  }

  private async executeAccumulate(intent: AccumulateIntent, ctx: EventContext): Promise<IntentResult> {
    const pk = intent.overrides?.pk ?? `T#${ctx.tenantId}`;
    const sk = intent.overrides?.sk ?? intent.typename;

    // Reuse guardedWrite from lambda-utils — single source of truth for transactional dedup
    const written = await guardedWrite(
      this.deps.docClient,
      this.deps.tableName,
      { pk, sk: `ProcessedEvent#${ctx.eventId}` },
      [{
        Update: {
          TableName: this.deps.tableName,
          Key: { pk, sk },
          UpdateExpression: 'ADD #field :inc',
          ExpressionAttributeNames: { '#field': intent.field },
          ExpressionAttributeValues: { ':inc': intent.increment },
        },
      }],
      intent.ttl,
    );

    return { _tag: 'accumulate', success: true, deduplicated: !written };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx nx test event-processor --testPathPattern=intent-executor --skip-nx-cache`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add libs/event-processor/src/engine/intent-executor.ts libs/event-processor/src/engine/__tests__/intent-executor.test.ts
git commit -m "feat(event-processor): add IntentExecutor (record→putIfNotExists, project→upsert, accumulate→guardedWrite)"
```

---

### Task 11: batchEngine

**Files:**
- Create: `libs/event-processor/src/engine/batch-engine.ts`
- Create: `libs/event-processor/src/engine/__tests__/batch-engine.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// libs/event-processor/src/engine/__tests__/batch-engine.test.ts
import { BatchEngine } from '../batch-engine';
import { record } from '../../intents/record';
import { skip } from '../../intents/skip';
import type { SQSEvent } from 'aws-lambda';

// Minimal mock of lambda-utils
jest.mock('@nestfolio/lambda-utils', () => ({
  parseRecord: jest.fn((sqsRecord) => {
    const body = JSON.parse(sqsRecord.body);
    return { event: body.detail ?? body, payload: {}, record: sqsRecord };
  }),
  isRetryable: jest.fn((err) => !(err as any).notRetryable),
  NotRetryableError: class NotRetryableError extends Error { notRetryable = true; },
  createServiceMetrics: jest.fn(() => ({
    addMetric: jest.fn(),
    publishStoredMetrics: jest.fn(),
  })),
  traceEvent: jest.fn(),
  publishErrorEvent: jest.fn(),
  extractTenantId: jest.fn(() => 'tenant-1'),
}));

function makeSqsEvent(records: Array<{ type: string; payload: Record<string, unknown>; receiveCount?: number }>): SQSEvent {
  return {
    Records: records.map((r, i) => ({
      messageId: `msg-${i}`,
      body: JSON.stringify({ detail: { id: `evt-${i}`, type: r.type, timestamp: '2026-01-01T00:00:00Z', subject: r.payload, context: { tenantId: 'tenant-1' } } }),
      attributes: { ApproximateReceiveCount: String(r.receiveCount ?? 1) } as any,
      messageAttributes: {},
      md5OfBody: '',
      eventSource: 'aws:sqs',
      eventSourceARN: '',
      awsRegion: 'us-east-1',
      receiptHandle: '',
    })),
  };
}

describe('BatchEngine', () => {
  let mockDocClient: any;

  beforeEach(() => {
    mockDocClient = { send: jest.fn().mockResolvedValue({}) };
    jest.clearAllMocks();
  });

  it('processes records and returns empty batchItemFailures on success', async () => {
    const engine = new BatchEngine({
      serviceName: 'test',
      handlers: {
        ORDER_FILLED: record('Entry', ({ subject }) => ({ amount: subject.amount })),
      },
      docClient: mockDocClient,
      tableName: 'TestTable',
    });

    const event = makeSqsEvent([{ type: 'ORDER_FILLED', payload: { amount: 100 } }]);
    const result = await engine.process(event);

    expect(result.batchItemFailures).toEqual([]);
    expect(mockDocClient.send).toHaveBeenCalledTimes(1);
  });

  it('skips unknown event types without error', async () => {
    const engine = new BatchEngine({
      serviceName: 'test',
      handlers: { ORDER_FILLED: record('Entry', ({ subject }) => subject) },
      docClient: mockDocClient,
      tableName: 'TestTable',
    });

    const event = makeSqsEvent([{ type: 'UNKNOWN_TYPE', payload: {} }]);
    const result = await engine.process(event);

    expect(result.batchItemFailures).toEqual([]);
    expect(mockDocClient.send).not.toHaveBeenCalled();
  });

  it('collects retryable errors as batchItemFailures', async () => {
    mockDocClient.send.mockRejectedValueOnce(new Error('timeout'));

    const engine = new BatchEngine({
      serviceName: 'test',
      handlers: { ORDER_FILLED: record('Entry', ({ subject }) => subject) },
      docClient: mockDocClient,
      tableName: 'TestTable',
    });

    const event = makeSqsEvent([{ type: 'ORDER_FILLED', payload: {} }]);
    const result = await engine.process(event);

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'msg-0' }]);
  });

  it('skips poison pills (receiveCount > max)', async () => {
    const engine = new BatchEngine({
      serviceName: 'test',
      handlers: { ORDER_FILLED: record('Entry', ({ subject }) => subject) },
      docClient: mockDocClient,
      tableName: 'TestTable',
      poisonPillMaxReceiveCount: 3,
    });

    const event = makeSqsEvent([{ type: 'ORDER_FILLED', payload: {}, receiveCount: 5 }]);
    const result = await engine.process(event);

    expect(result.batchItemFailures).toEqual([]);
    expect(mockDocClient.send).not.toHaveBeenCalled();
  });

  it('processes multiple records with mixed outcomes', async () => {
    mockDocClient.send
      .mockResolvedValueOnce({})       // msg-0 success
      .mockRejectedValueOnce(new Error('timeout'))  // msg-1 retryable error
      .mockResolvedValueOnce({});      // msg-2 success

    const engine = new BatchEngine({
      serviceName: 'test',
      handlers: { ORDER_FILLED: record('Entry', ({ subject }) => subject) },
      docClient: mockDocClient,
      tableName: 'TestTable',
    });

    const event = makeSqsEvent([
      { type: 'ORDER_FILLED', payload: { a: 1 } },
      { type: 'ORDER_FILLED', payload: { a: 2 } },
      { type: 'ORDER_FILLED', payload: { a: 3 } },
    ]);
    const result = await engine.process(event);

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'msg-1' }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx nx test event-processor --testPathPattern=batch-engine --skip-nx-cache`
Expected: FAIL

- [ ] **Step 3: Implement batch-engine.ts**

```typescript
import type { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { parseRecord, isRetryable, traceEvent, extractTenantId, createServiceMetrics, publishErrorEvent } from '@nestfolio/lambda-utils';
import type { HandlerEntry } from '../types/handler-config';
import type { EventContext } from '../types/event-context';
import { normalizeHandler } from './normalize-handler';
import { IntentExecutor } from './intent-executor';
import { ErrorCollector } from './error-collector';
import { asyncPool } from '../util/async-pool';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const DEFAULT_CONCURRENCY = 5;
const DEFAULT_POISON_PILL_MAX = 5;

export interface BatchEngineConfig {
  serviceName: string;
  handlers: Record<string, HandlerEntry>;
  docClient: DynamoDBDocumentClient;
  tableName: string;
  busName?: string;
  concurrency?: number;
  poisonPillMaxReceiveCount?: number;
  errorEventType?: string;
}

export class BatchEngine {
  private readonly normalizedHandlers: Map<string, ReturnType<typeof normalizeHandler>>;
  private readonly intentExecutor: IntentExecutor;
  private readonly config: BatchEngineConfig;

  constructor(config: BatchEngineConfig) {
    this.config = config;
    this.intentExecutor = new IntentExecutor({ docClient: config.docClient, tableName: config.tableName });
    this.normalizedHandlers = new Map();
    for (const [eventType, entry] of Object.entries(config.handlers)) {
      this.normalizedHandlers.set(eventType, normalizeHandler(entry));
    }
  }

  async process(event: SQSEvent): Promise<SQSBatchResponse> {
    const startedAt = Date.now();
    const collector = new ErrorCollector();
    const concurrency = this.config.concurrency ?? DEFAULT_CONCURRENCY;
    const maxReceive = this.config.poisonPillMaxReceiveCount ?? DEFAULT_POISON_PILL_MAX;

    await asyncPool(
      event.Records,
      async (sqsRecord) => {
        const messageId = sqsRecord.messageId;
        const receiveCount = parseInt(sqsRecord.attributes?.ApproximateReceiveCount ?? '1', 10);

        // Poison pill check
        if (receiveCount > maxReceive) {
          collector.recordPoisonPill(messageId);
          return;
        }

        try {
          // Parse
          const uow = parseRecord(sqsRecord);
          const eventType = uow.event.type;

          // Context
          const tenantId = extractTenantId(uow.event);
          traceEvent(eventType, uow.event.id, tenantId);  // 3 args: type, id, tenantId

          // Route
          const handler = this.normalizedHandlers.get(eventType);
          if (!handler) {
            collector.recordSkipped(messageId);
            return;
          }

          // Build context
          const ctx: EventContext = {
            eventId: uow.event.id,
            eventType,
            tenantId,
            userId: uow.event.context?.userId as string | undefined,
            timestamp: uow.event.timestamp,
            receiveCount,
            serviceName: this.config.serviceName,
            record: sqsRecord,
          };

          // Execute handler → intents
          const intents = await handler({ subject: uow.event.subject, context: uow.event.context }, ctx);

          // Execute intents
          let anyDeduplicated = false;
          for (const intent of intents) {
            const result = await this.intentExecutor.execute(intent, ctx);
            if (result.deduplicated) anyDeduplicated = true;
          }

          if (anyDeduplicated) {
            collector.recordDeduplicated(messageId, eventType);
          } else {
            collector.recordSuccess(messageId, eventType);
          }
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          const retryable = isRetryable(err);
          collector.recordError(messageId, 'UNKNOWN', err, retryable);
        }
      },
      { concurrency },
    );

    const results = collector.getResults();

    // Publish non-retryable errors to bus
    if (results.droppedErrors.length > 0 && this.config.busName) {
      const errorType = this.config.errorEventType ?? `${this.config.serviceName.toUpperCase().replace(/-/g, '_')}_FAILED`;
      for (const { error } of results.droppedErrors) {
        await publishErrorEvent({ name: this.config.busName } as any, errorType, error);
      }
    }

    // BatchDuration metric
    results.metrics.BatchDuration = Date.now() - startedAt;

    return {
      batchItemFailures: results.batchItemFailures.map((id) => ({ itemIdentifier: id })),
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx nx test event-processor --testPathPattern=batch-engine --skip-nx-cache`
Expected: PASS (5 tests)

- [ ] **Step 5: Create engine/index.ts**

```typescript
export { normalizeHandler } from './normalize-handler';
export { IntentExecutor } from './intent-executor';
export { ErrorCollector } from './error-collector';
export type { CollectorResults } from './error-collector';
export { BatchEngine } from './batch-engine';
export type { BatchEngineConfig } from './batch-engine';
```

- [ ] **Step 6: Commit**

```bash
git add libs/event-processor/src/engine/
git commit -m "feat(event-processor): add BatchEngine (SQS batch loop with error isolation + intent execution)"
```

---

## Chunk 4: SQS Pipelines + Testing

### Task 12: createEventHandler + materializeToTable

**Files:**
- Create: `libs/event-processor/src/pipelines/create-event-handler.ts`
- Create: `libs/event-processor/src/pipelines/materialize-to-table.ts`
- Create: `libs/event-processor/src/pipelines/__tests__/create-event-handler.test.ts`
- Create: `libs/event-processor/src/pipelines/__tests__/materialize-to-table.test.ts`

- [ ] **Step 1: Write failing tests for createEventHandler**

```typescript
// libs/event-processor/src/pipelines/__tests__/create-event-handler.test.ts
import { createEventHandler } from '../create-event-handler';
import { record } from '../../intents/record';

jest.mock('@nestfolio/lambda-utils', () => ({
  parseRecord: jest.fn((sqsRecord) => {
    const body = JSON.parse(sqsRecord.body);
    return { event: body.detail ?? body, payload: {}, record: sqsRecord };
  }),
  isRetryable: jest.fn(() => true),
  NotRetryableError: class extends Error {},
  createServiceMetrics: jest.fn(() => ({ addMetric: jest.fn(), publishStoredMetrics: jest.fn() })),
  traceEvent: jest.fn(),
  publishErrorEvent: jest.fn(),
  extractTenantId: jest.fn(() => 'tenant-1'),
}));

function makeSqsEvent(type: string, payload: Record<string, unknown>) {
  return {
    Records: [{
      messageId: 'msg-1',
      body: JSON.stringify({ detail: { id: 'evt-1', type, timestamp: '2026-01-01T00:00:00Z', subject: payload, context: { tenantId: 'tenant-1' } } }),
      attributes: { ApproximateReceiveCount: '1' } as any,
      messageAttributes: {}, md5OfBody: '', eventSource: 'aws:sqs', eventSourceARN: '', awsRegion: 'us-east-1', receiptHandle: '',
    }],
  };
}

describe('createEventHandler()', () => {
  it('returns a Lambda handler function', () => {
    const handler = createEventHandler({
      serviceName: 'test',
      handlers: { TEST: record('Entry', ({ subject }) => subject) },
      table: { name: 'T', client: { send: jest.fn().mockResolvedValue({}) } as any },
    });
    expect(typeof handler).toBe('function');
  });

  it('processes events and returns SQSBatchResponse', async () => {
    const handler = createEventHandler({
      serviceName: 'test',
      handlers: { ORDER_FILLED: record('Entry', ({ subject }) => ({ a: subject.a })) },
      table: { name: 'T', client: { send: jest.fn().mockResolvedValue({}) } as any },
    });

    const result = await handler(makeSqsEvent('ORDER_FILLED', { a: 1 }));
    expect(result.batchItemFailures).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx nx test event-processor --testPathPattern=create-event-handler --skip-nx-cache`
Expected: FAIL

- [ ] **Step 3: Implement create-event-handler.ts**

```typescript
import type { SQSEvent, SQSBatchResponse, Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { applyMiddleware, withLambdaContext, withTiming } from '@nestfolio/lambda-utils';
import type { HandlerEntry } from '../types/handler-config';
import { BatchEngine } from '../engine/batch-engine';

export interface EventHandlerConfig {
  serviceName: string;
  handlers: Record<string, HandlerEntry>;
  table?: string | { name: string; client: DynamoDBDocumentClient };
  bus?: string;
  concurrency?: number;
  poisonPill?: { maxReceiveCount: number };
  errorEventType?: string;
}

export function createEventHandler(
  config: EventHandlerConfig,
): (event: SQSEvent, context?: Context) => Promise<SQSBatchResponse> {
  const tableName = typeof config.table === 'string'
    ? config.table
    : config.table?.name ?? process.env.TABLE_NAME!;

  const docClient = typeof config.table === 'object' && 'client' in config.table
    ? config.table.client
    : DynamoDBDocumentClient.from(new DynamoDBClient({}));

  const engine = new BatchEngine({
    serviceName: config.serviceName,
    handlers: config.handlers,
    docClient,
    tableName,
    busName: typeof config.bus === 'string' ? config.bus : process.env.BUS_NAME,
    concurrency: config.concurrency,
    poisonPillMaxReceiveCount: config.poisonPill?.maxReceiveCount,
    errorEventType: config.errorEventType,
  });

  const handler = async (event: unknown): Promise<SQSBatchResponse> => {
    return engine.process(event as SQSEvent);
  };

  return applyMiddleware(
    handler,
    withLambdaContext(),
    withTiming(`${config.serviceName}-event-listener`),
  ) as (event: SQSEvent, context?: Context) => Promise<SQSBatchResponse>;
}
```

- [ ] **Step 4: Implement materialize-to-table.ts**

```typescript
import type { SQSEvent, SQSBatchResponse, Context } from 'aws-lambda';
import type { HandlerEntry } from '../types/handler-config';
import { createEventHandler } from './create-event-handler';

export interface MaterializeToTableConfig {
  serviceName: string;
  handlers: Record<string, HandlerEntry>;
  table?: string;
  bus?: string;
  concurrency?: number;
  poisonPill?: { maxReceiveCount: number };
}

export function materializeToTable(
  config: MaterializeToTableConfig,
): (event: SQSEvent, context?: Context) => Promise<SQSBatchResponse> {
  return createEventHandler({
    serviceName: config.serviceName,
    handlers: config.handlers,
    table: config.table ?? process.env.TABLE_NAME!,
    bus: config.bus ?? process.env.BUS_NAME,
    concurrency: config.concurrency,
    poisonPill: config.poisonPill,
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx nx test event-processor --testPathPattern=create-event-handler --skip-nx-cache`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add libs/event-processor/src/pipelines/create-event-handler.ts libs/event-processor/src/pipelines/materialize-to-table.ts libs/event-processor/src/pipelines/__tests__/
git commit -m "feat(event-processor): add createEventHandler + materializeToTable pipeline factories"
```

---

### Task 13: Test harness + fake records

**Files:**
- Create: `libs/event-processor/src/testing/test-harness.ts`
- Create: `libs/event-processor/src/testing/fake-records.ts`
- Create: `libs/event-processor/src/testing/index.ts`
- Create: `libs/event-processor/src/testing/__tests__/test-harness.test.ts`

- [ ] **Step 1: Write failing tests for test harness**

```typescript
// libs/event-processor/src/testing/__tests__/test-harness.test.ts
import { createTestHarness } from '../test-harness';
import { fakeSqsRecord } from '../fake-records';
import { record } from '../../intents/record';
import { project } from '../../intents/project';
import { accumulate } from '../../intents/accumulate';

describe('createTestHarness()', () => {
  it('collects intents from handler config', async () => {
    const harness = createTestHarness({
      serviceName: 'test',
      handlers: {
        ORDER_FILLED: record('Entry', ({ subject }) => ({ amount: subject.amount })),
      },
    });

    const result = await harness.process([
      fakeSqsRecord('ORDER_FILLED', { amount: 100 }),
    ]);

    expect(result.intents).toEqual([
      expect.objectContaining({ _tag: 'record', typename: 'Entry', fields: { amount: 100 } }),
    ]);
    expect(result.metrics.EventProcessed).toBe(1);
  });

  it('reports unknown event types as skipped', async () => {
    const harness = createTestHarness({
      serviceName: 'test',
      handlers: { ORDER_FILLED: record('Entry', () => ({})) },
    });

    const result = await harness.process([
      fakeSqsRecord('UNKNOWN_TYPE', {}),
    ]);

    expect(result.skipped).toBe(1);
    expect(result.intents).toEqual([]);
  });

  it('handles multi-intent handlers', async () => {
    const harness = createTestHarness({
      serviceName: 'test',
      handlers: {
        ORDER_FILLED: [
          record('Activity', ({ subject }) => ({ desc: subject.desc })),
          accumulate('Stats', { field: 'count', increment: 1 }),
        ],
      },
    });

    const result = await harness.process([
      fakeSqsRecord('ORDER_FILLED', { desc: 'test' }),
    ]);

    expect(result.intents).toHaveLength(2);
    expect(result.intents[0]._tag).toBe('record');
    expect(result.intents[1]._tag).toBe('accumulate');
  });

  it('catches handler errors and reports them', async () => {
    const harness = createTestHarness({
      serviceName: 'test',
      handlers: {
        BAD_EVENT: async () => { throw new Error('handler boom'); },
      },
    });

    const result = await harness.process([
      fakeSqsRecord('BAD_EVENT', {}),
    ]);

    expect(result.metrics.EventFailed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error.message).toBe('handler boom');
  });

  it('detects poison pills', async () => {
    const harness = createTestHarness({
      serviceName: 'test',
      handlers: { ORDER_FILLED: record('Entry', () => ({})) },
      poisonPill: { maxReceiveCount: 3 },
    });

    const result = await harness.process([
      fakeSqsRecord('ORDER_FILLED', {}, { receiveCount: 5 }),
    ]);

    expect(result.poisonPills).toBe(1);
    expect(result.batchItemFailures).toHaveLength(0);
  });
});

describe('fakeSqsRecord()', () => {
  it('creates a valid SQS record', () => {
    const rec = fakeSqsRecord('ORDER_FILLED', { amount: 100 });
    expect(rec.messageId).toBeDefined();
    expect(rec.body).toBeDefined();

    const body = JSON.parse(rec.body);
    expect(body.detail.type).toBe('ORDER_FILLED');
    expect(body.detail.subject.amount).toBe(100);
  });

  it('supports custom eventId and tenantId', () => {
    const rec = fakeSqsRecord('TEST', {}, { eventId: 'custom-evt', tenantId: 'custom-t' });
    const body = JSON.parse(rec.body);
    expect(body.detail.id).toBe('custom-evt');
    expect(body.detail.context.tenantId).toBe('custom-t');
  });

  it('supports custom receiveCount', () => {
    const rec = fakeSqsRecord('TEST', {}, { receiveCount: 7 });
    expect(rec.attributes.ApproximateReceiveCount).toBe('7');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx nx test event-processor --testPathPattern=test-harness --skip-nx-cache`
Expected: FAIL

- [ ] **Step 3: Implement fake-records.ts**

```typescript
import type { SQSRecord, DynamoDBRecord } from 'aws-lambda';
import { randomUUID } from 'crypto';

export function fakeSqsRecord(
  eventType: string,
  payload: Record<string, unknown>,
  opts?: { eventId?: string; tenantId?: string; receiveCount?: number },
): SQSRecord {
  const eventId = opts?.eventId ?? randomUUID();
  const tenantId = opts?.tenantId ?? 'test-tenant';

  return {
    messageId: randomUUID(),
    receiptHandle: '',
    body: JSON.stringify({
      detail: {
        id: eventId,
        type: eventType,
        timestamp: new Date().toISOString(),
        subject: payload,
        context: { tenantId },
      },
    }),
    attributes: {
      ApproximateReceiveCount: String(opts?.receiveCount ?? 1),
      SentTimestamp: '',
      SenderId: '',
      ApproximateFirstReceiveTimestamp: '',
    },
    messageAttributes: {},
    md5OfBody: '',
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn:aws:sqs:us-east-1:000000000000:test-queue',
    awsRegion: 'us-east-1',
  };
}

export function fakeDdbStreamRecord(
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE',
  newImage: Record<string, unknown>,
  opts?: { oldImage?: Record<string, unknown> },
): DynamoDBRecord {
  return {
    eventID: randomUUID(),
    eventName,
    eventVersion: '1.1',
    eventSource: 'aws:dynamodb',
    awsRegion: 'us-east-1',
    dynamodb: {
      Keys: {
        pk: { S: newImage.pk as string ?? 'pk-1' },
        sk: { S: newImage.sk as string ?? 'sk-1' },
      },
      NewImage: eventName !== 'REMOVE' ? toAttributeMap(newImage) : undefined,
      OldImage: opts?.oldImage ? toAttributeMap(opts.oldImage) : (eventName === 'REMOVE' ? toAttributeMap(newImage) : undefined),
      StreamViewType: 'NEW_AND_OLD_IMAGES',
      SequenceNumber: '1',
      SizeBytes: 100,
    },
    eventSourceARN: 'arn:aws:dynamodb:us-east-1:000000000000:table/test/stream/2026-01-01',
  };
}

function toAttributeMap(obj: Record<string, unknown>): Record<string, any> {
  const map: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') map[key] = { S: value };
    else if (typeof value === 'number') map[key] = { N: String(value) };
    else if (typeof value === 'boolean') map[key] = { BOOL: value };
    else if (value === null || value === undefined) map[key] = { NULL: true };
    else map[key] = { S: JSON.stringify(value) };
  }
  return map;
}
```

- [ ] **Step 4: Implement test-harness.ts**

```typescript
import type { WriteIntent } from '../types/write-intent';
import type { EventPayload, HandlerEntry } from '../types/handler-config';
import type { EventContext } from '../types/event-context';
import type { SQSRecord } from 'aws-lambda';
import { normalizeHandler } from '../engine/normalize-handler';

export interface TestHarnessConfig {
  serviceName: string;
  handlers: Record<string, HandlerEntry>;
  poisonPill?: { maxReceiveCount: number };
}

export interface TestResult {
  intents: WriteIntent[];
  metrics: Record<string, number>;
  errors: Array<{ messageId: string; error: Error; retryable: boolean }>;
  batchItemFailures: string[];
  deduplicated: number;
  poisonPills: number;
  skipped: number;
}

export function createTestHarness(config: TestHarnessConfig) {
  const normalizedHandlers = new Map<string, ReturnType<typeof normalizeHandler>>();
  for (const [eventType, entry] of Object.entries(config.handlers)) {
    normalizedHandlers.set(eventType, normalizeHandler(entry));
  }

  return {
    async process(records: SQSRecord[]): Promise<TestResult> {
      const intents: WriteIntent[] = [];
      const errors: Array<{ messageId: string; error: Error; retryable: boolean }> = [];
      const batchItemFailures: string[] = [];
      let poisonPills = 0;
      let skipped = 0;
      let deduplicated = 0;
      const metrics: Record<string, number> = {
        EventProcessed: 0,
        EventFailed: 0,
        EventDeduplicated: 0,
        EventDropped: 0,
        PoisonPillDetected: 0,
        EventSkipped: 0,
        BatchSize: 0,
      };

      const maxReceive = config.poisonPill?.maxReceiveCount ?? 5;

      for (const sqsRecord of records) {
        metrics.BatchSize++;
        const messageId = sqsRecord.messageId;
        const receiveCount = parseInt(sqsRecord.attributes?.ApproximateReceiveCount ?? '1', 10);

        if (receiveCount > maxReceive) {
          poisonPills++;
          metrics.PoisonPillDetected++;
          continue;
        }

        try {
          const body = JSON.parse(sqsRecord.body);
          const event = body.detail ?? body;
          const eventType = event.type;
          const tenantId = event.context?.tenantId ?? 'test-tenant';

          const handler = normalizedHandlers.get(eventType);
          if (!handler) {
            skipped++;
            metrics.EventSkipped++;
            continue;
          }

          const ctx: EventContext = {
            eventId: event.id,
            eventType,
            tenantId,
            userId: event.context?.userId,
            timestamp: event.timestamp,
            receiveCount,
            serviceName: config.serviceName,
            record: sqsRecord,
          };

          const payload: EventPayload = { subject: event.subject, context: event.context };
          const result = await handler(payload, ctx);
          intents.push(...result);
          metrics.EventProcessed++;
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          errors.push({ messageId, error: err, retryable: true });
          batchItemFailures.push(messageId);
          metrics.EventFailed++;
        }
      }

      return { intents, metrics, errors, batchItemFailures, deduplicated, poisonPills, skipped };
    },
  };
}
```

- [ ] **Step 5: Create testing/index.ts**

```typescript
export { createTestHarness } from './test-harness';
export type { TestHarnessConfig, TestResult } from './test-harness';
export { fakeSqsRecord, fakeDdbStreamRecord } from './fake-records';
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx nx test event-processor --testPathPattern=test-harness --skip-nx-cache`
Expected: PASS (8 tests)

- [ ] **Step 7: Commit**

```bash
git add libs/event-processor/src/testing/
git commit -m "feat(event-processor): add test harness (createTestHarness, fakeSqsRecord, fakeDdbStreamRecord)"
```

---

### Task 14: Final exports + full test run

**Files:**
- Modify: `libs/event-processor/src/index.ts`
- Create: `libs/event-processor/src/pipelines/index.ts`

- [ ] **Step 1: Create pipelines/index.ts**

```typescript
export { createEventHandler } from './create-event-handler';
export type { EventHandlerConfig } from './create-event-handler';
export { materializeToTable } from './materialize-to-table';
export type { MaterializeToTableConfig } from './materialize-to-table';
```

- [ ] **Step 2: Update src/index.ts with full public API**

```typescript
// @nestfolio/event-processor — public API

// Types
export type { WriteIntent, RecordIntent, ProjectIntent, AccumulateIntent, S3PutIntent, SkipIntent, KeyOverrides } from './types/write-intent';
export type { HandlerFn, HandlerEntry, EventPayload } from './types/handler-config';
export type { EventContext } from './types/event-context';
export type { StreamRecord, StreamContext } from './types/stream-types';
export type { RecordResult, IntentResult, BatchResult, RecordOutcome } from './types/result-types';

// Intent helpers
export { record } from './intents/record';
export { project } from './intents/project';
export { accumulate } from './intents/accumulate';
export { s3Put } from './intents/s3-put';
export { skip } from './intents/skip';

// Utilities
export { asyncPool } from './util/async-pool';
export { groupBy } from './util/group-by';
export { forkMerge } from './util/fork-merge';
export type { Branch, BranchResult } from './util/fork-merge';
export { toCsv } from './util/csv-serializer';

// SQS Pipelines
export { createEventHandler } from './pipelines/create-event-handler';
export type { EventHandlerConfig } from './pipelines/create-event-handler';
export { materializeToTable } from './pipelines/materialize-to-table';
export type { MaterializeToTableConfig } from './pipelines/materialize-to-table';

// Engine (advanced)
export { BatchEngine } from './engine/batch-engine';
export { IntentExecutor } from './engine/intent-executor';
export { ErrorCollector } from './engine/error-collector';

// Testing (re-exported from /testing subpath)
export { createTestHarness } from './testing/test-harness';
export type { TestHarnessConfig, TestResult } from './testing/test-harness';
export { fakeSqsRecord, fakeDdbStreamRecord } from './testing/fake-records';
```

- [ ] **Step 3: Run full test suite**

Run: `npx nx test event-processor --skip-nx-cache`
Expected: PASS (all tests across all test files)

- [ ] **Step 4: Verify build**

Run: `npx nx build event-processor --skip-nx-cache`
Expected: BUILD SUCCESS

- [ ] **Step 5: Commit**

```bash
git add libs/event-processor/src/
git commit -m "feat(event-processor): wire up full public API exports"
```

---

## Chunk 5: DDB Stream Pipelines (Future)

> Tasks 15-18 cover `createStreamHandler`, `changeDataCapture`, `replayAndReduce`, and `materializeToBucket`. These are deferred to a follow-up plan to keep this plan focused on the core SQS processing framework that covers 11 of 11 event listeners.
>
> The SQS pipeline (Chunks 1-4) is a complete, shippable unit — services can adopt `materializeToTable` and `createEventHandler` immediately.
>
> DDB Stream pipelines will be planned separately after the SQS framework is validated in at least 2-3 services.

---

## Summary

| Chunk | Tasks | Tests (est.) | What it delivers |
|-------|-------|-------------|-----------------|
| 1: Scaffolding + Types + Intents | 1-3 | ~17 | Library skeleton, all types, intent helpers |
| 2: Concurrency Utilities | 4-7 | ~19 | asyncPool, groupBy, forkMerge, csvSerializer |
| 3: Engine Core | 8-11 | ~25 | normalizeHandler, errorCollector, intentExecutor, batchEngine |
| 4: Pipelines + Testing | 12-14 | ~10 | createEventHandler, materializeToTable, test harness, public API |
| **Total** | **14 tasks** | **~71 tests** | **Full SQS event processing framework** |
