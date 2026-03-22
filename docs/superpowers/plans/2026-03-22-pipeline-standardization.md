# Pipeline Standardization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all 19 handler files to use named pipelines (`materializeToTable`, `materializeToBucket`, `resumeStateMachine`) with intent-based writes, replacing direct `createEventHandler` calls and manual repository writes.

**Architecture:** Two-phase approach — Phase 1 extends the event-processor library (new intents, new pipeline, file restructuring), Phase 2 rewrites all service handlers. No backward compatibility needed.

**Tech Stack:** TypeScript, AWS SDK v3 (DynamoDB, S3, SFN, EventBridge), `@nestfolio/event-processor`, Jest, Nx

**Spec:** `docs/superpowers/specs/2026-03-22-pipeline-standardization-design.md`

---

## Phase 1: Library Overhaul (`@nestfolio/event-processor`)

### Task 1: Add `UpdateIntent` type and `update()` helper

**Files:**
- Modify: `libs/event-processor/src/types/write-intent.ts`
- Create: `libs/event-processor/src/intents/update.ts`
- Modify: `libs/event-processor/src/intents/index.ts`
- Test: `libs/event-processor/test/intents/intents.test.ts`

- [ ] **Step 1: Write failing test for `update()` helper**

Add to `libs/event-processor/test/intents/intents.test.ts`:

```ts
describe('update', () => {
  it('should create UpdateIntent with updates only', () => {
    const intent = update('DecisionPacket', { status: 'APPROVED' });
    expect(intent).toEqual({
      _tag: 'update',
      typename: 'DecisionPacket',
      updates: { status: 'APPROVED' },
    });
  });

  it('should create UpdateIntent with removes and condition', () => {
    const intent = update('DecisionPacket', { status: 'BLOCKED' }, {
      removes: ['tempField'],
      condition: 'attribute_exists(pk)',
      overrides: { pk: 'custom-pk', sk: 'custom-sk' },
    });
    expect(intent).toEqual({
      _tag: 'update',
      typename: 'DecisionPacket',
      updates: { status: 'BLOCKED' },
      removes: ['tempField'],
      condition: 'attribute_exists(pk)',
      overrides: { pk: 'custom-pk', sk: 'custom-sk' },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test event-processor -- --testPathPattern=intents`
Expected: FAIL — `update` is not exported

- [ ] **Step 3: Add `UpdateIntent` to write-intent.ts**

In `libs/event-processor/src/types/write-intent.ts`, add before `S3PutIntent`:

```ts
export interface UpdateIntent {
  readonly _tag: 'update';
  readonly typename: string;
  readonly updates: Record<string, unknown>;
  readonly removes?: string[];
  readonly condition?: string;
  readonly overrides?: KeyOverrides;
}
```

Update the `WriteIntent` union type to include `UpdateIntent`.

- [ ] **Step 4: Create `update.ts` intent helper**

Create `libs/event-processor/src/intents/update.ts`:

```ts
import type { UpdateIntent, KeyOverrides } from '../types/write-intent';

export function update(
  typename: string,
  updates: Record<string, unknown>,
  options?: { removes?: string[]; condition?: string; overrides?: KeyOverrides },
): UpdateIntent {
  return {
    _tag: 'update',
    typename,
    updates,
    ...(options?.removes ? { removes: options.removes } : {}),
    ...(options?.condition ? { condition: options.condition } : {}),
    ...(options?.overrides ? { overrides: options.overrides } : {}),
  };
}
```

- [ ] **Step 5: Export from intents barrel and types barrel**

In `libs/event-processor/src/intents/index.ts`, add: `export { update } from './update';`

In `libs/event-processor/src/types/write-intent.ts`, ensure `UpdateIntent` is in the union.

In `libs/event-processor/src/index.ts`, add `update` to the intent helpers export block (near line 16).

Also add `UpdateIntent` to the type exports (near line 5).

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm nx test event-processor -- --testPathPattern=intents`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add libs/event-processor/src/types/write-intent.ts libs/event-processor/src/intents/update.ts libs/event-processor/src/intents/index.ts libs/event-processor/src/index.ts libs/event-processor/test/intents/intents.test.ts
git commit -m "feat(event-processor): add update() intent and UpdateIntent type"
```

---

### Task 2: Implement `update` executor in IntentExecutor

**Files:**
- Modify: `libs/event-processor/src/engine/intent-executor.ts`
- Test: `libs/event-processor/test/engine/intent-executor.test.ts`

- [ ] **Step 1: Write failing test for update executor**

Add to `libs/event-processor/test/engine/intent-executor.test.ts`:

```ts
describe('executeUpdate', () => {
  it('should build UpdateCommand with SET expression', async () => {
    const intent = update('DecisionPacket', { status: 'APPROVED', authorityLevel: 'L1' });
    const result = await executor.execute(intent, fakeCtx);
    expect(result).toEqual({ _tag: 'update', success: true });
    expect(mockDocClient.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          TableName: 'test-table',
          Key: { pk: `T#${fakeCtx.tenantId}`, sk: 'DecisionPacket' },
        }),
      }),
    );
  });

  it('should include REMOVE expression when removes specified', async () => {
    const intent = update('DecisionPacket', { status: 'BLOCKED' }, { removes: ['tempField'] });
    const result = await executor.execute(intent, fakeCtx);
    expect(result).toEqual({ _tag: 'update', success: true });
  });

  it('should use key overrides when provided', async () => {
    const intent = update('DecisionPacket', { status: 'APPROVED' }, {
      overrides: { pk: 'custom-pk', sk: 'custom-sk' },
    });
    const result = await executor.execute(intent, fakeCtx);
    expect(result).toEqual({ _tag: 'update', success: true });
    expect(mockDocClient.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          Key: { pk: 'custom-pk', sk: 'custom-sk' },
        }),
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test event-processor -- --testPathPattern=intent-executor`
Expected: FAIL

- [ ] **Step 3: Implement executeUpdate in IntentExecutor**

In `libs/event-processor/src/engine/intent-executor.ts`, add the `update` case to the switch and implement `executeUpdate`:

```ts
case 'update': return this.executeUpdate(intent, ctx);
```

```ts
private async executeUpdate(intent: UpdateIntent, ctx: EventContext): Promise<IntentResult> {
  const pk = intent.overrides?.pk ?? `T#${ctx.tenantId}`;
  const sk = intent.overrides?.sk ?? intent.typename;

  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const setParts: string[] = [];

  // Always add updatedAt
  const allUpdates = { ...intent.updates, updatedAt: ctx.timestamp };

  let i = 0;
  for (const [field, value] of Object.entries(allUpdates)) {
    const nameKey = `#f${i}`;
    const valKey = `:v${i}`;
    names[nameKey] = field;
    values[valKey] = value;
    setParts.push(`${nameKey} = ${valKey}`);
    i++;
  }

  let updateExpr = `SET ${setParts.join(', ')}`;

  if (intent.removes && intent.removes.length > 0) {
    const removeParts = intent.removes.map((field, j) => {
      const nameKey = `#r${j}`;
      names[nameKey] = field;
      return nameKey;
    });
    updateExpr += ` REMOVE ${removeParts.join(', ')}`;
  }

  await this.deps.docClient.send(new UpdateCommand({
    TableName: this.deps.tableName,
    Key: { pk, sk },
    UpdateExpression: updateExpr,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    ...(intent.condition ? { ConditionExpression: intent.condition } : {}),
  }));

  return { _tag: 'update', success: true };
}
```

Add `UpdateCommand` to the imports from `@aws-sdk/lib-dynamodb`. Add `UpdateIntent` to the type imports.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx test event-processor -- --testPathPattern=intent-executor`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add libs/event-processor/src/engine/intent-executor.ts libs/event-processor/test/engine/intent-executor.test.ts
git commit -m "feat(event-processor): implement update executor in IntentExecutor"
```

---

### Task 3: Rename `s3Put` → `store` and implement store executor

**Files:**
- Rename: `libs/event-processor/src/intents/s3-put.ts` → `libs/event-processor/src/intents/store.ts`
- Modify: `libs/event-processor/src/types/write-intent.ts` (S3PutIntent → StoreIntent, `s3-put` → `store`)
- Modify: `libs/event-processor/src/intents/index.ts`
- Modify: `libs/event-processor/src/engine/intent-executor.ts`
- Modify: `libs/event-processor/src/index.ts`
- Modify: `libs/event-processor/src/pipelines/materialize-to-bucket.ts`
- Test: `libs/event-processor/test/intents/intents.test.ts`
- Test: `libs/event-processor/test/engine/intent-executor.test.ts`

- [ ] **Step 1: Write failing test for `store()` helper**

In `libs/event-processor/test/intents/intents.test.ts`, rename any existing `s3Put` tests to `store` and add:

```ts
describe('store', () => {
  it('should create StoreIntent with defaults', () => {
    const intent = store({ data: 'test' });
    expect(intent).toEqual({
      _tag: 'store',
      body: { data: 'test' },
      format: 'json',
    });
  });

  it('should create StoreIntent with custom key and format', () => {
    const intent = store('csv content', { key: 'exports/data.csv', format: 'csv' });
    expect(intent).toEqual({
      _tag: 'store',
      body: 'csv content',
      format: 'csv',
      key: 'exports/data.csv',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test event-processor -- --testPathPattern=intents`
Expected: FAIL — `store` is not exported

- [ ] **Step 3: Rename S3PutIntent → StoreIntent in write-intent.ts**

In `libs/event-processor/src/types/write-intent.ts`:
- Rename `S3PutIntent` → `StoreIntent`
- Change `_tag: 's3-put'` → `_tag: 'store'`
- Update the `WriteIntent` union type

- [ ] **Step 4: Create store.ts, delete s3-put.ts**

Create `libs/event-processor/src/intents/store.ts`:

```ts
import type { StoreIntent } from '../types/write-intent';

export function store(body: unknown, opts?: { format?: 'json' | 'csv'; key?: string }): StoreIntent {
  return {
    _tag: 'store',
    body,
    format: opts?.format ?? 'json',
    key: opts?.key,
  };
}
```

Delete `libs/event-processor/src/intents/s3-put.ts`.

- [ ] **Step 5: Update intents barrel**

In `libs/event-processor/src/intents/index.ts`, replace `s3Put` line with: `export { store } from './store';`

- [ ] **Step 6: Update IntentExecutor — rename case + implement S3 write**

In `libs/event-processor/src/engine/intent-executor.ts`:
- Change `case 's3-put'` → `case 'store'`
- Implement actual S3 write:

```ts
private async executeStore(intent: StoreIntent, ctx: EventContext): Promise<IntentResult> {
  const key = intent.key ?? `${ctx.serviceName}/${ctx.eventType}/${ctx.eventId}.${intent.format ?? 'json'}`;
  const body = intent.format === 'csv' && typeof intent.body !== 'string'
    ? toCsv(intent.body as Record<string, unknown>[])
    : JSON.stringify(intent.body);

  await this.deps.s3Client.send(new PutObjectCommand({
    Bucket: this.deps.bucket!,
    Key: key,
    Body: body,
    ContentType: intent.format === 'csv' ? 'text/csv' : 'application/json',
  }));

  return { _tag: 'store', success: true };
}
```

Update the `ExecutorDeps` interface to add optional `s3Client` and `bucket` fields. Add S3 imports.

- [ ] **Step 7: Update index.ts exports**

In `libs/event-processor/src/index.ts`:
- Replace `export { s3Put }` with `export { store }`
- Replace `S3PutIntent` with `StoreIntent` in type exports

- [ ] **Step 8: Update materialize-to-bucket.ts**

In `libs/event-processor/src/pipelines/materialize-to-bucket.ts`, update the reference from `s3` config to pass `s3Client` and `bucket` to the engine config so `IntentExecutor` can use them.

- [ ] **Step 9: Run all event-processor tests**

Run: `pnpm nx test event-processor`
Expected: ALL PASS

- [ ] **Step 10: Commit**

```bash
git add libs/event-processor/
git commit -m "feat(event-processor): rename s3Put to store, implement store executor"
```

---

### Task 4: Move foundations to `engine/`, update pipeline barrel

**Files:**
- Move: `libs/event-processor/src/pipelines/create-event-handler.ts` → `libs/event-processor/src/engine/create-event-handler.ts`
- Move: `libs/event-processor/src/pipelines/create-stream-handler.ts` → `libs/event-processor/src/engine/create-stream-handler.ts`
- Modify: `libs/event-processor/src/pipelines/index.ts` (remove foundation exports)
- Modify: `libs/event-processor/src/pipelines/materialize-to-table.ts` (update import path)
- Modify: `libs/event-processor/src/pipelines/materialize-to-bucket.ts` (update import path)
- Modify: `libs/event-processor/src/pipelines/change-data-capture.ts` (if it imports createStreamHandler)
- Modify: `libs/event-processor/src/pipelines/replay-and-reduce.ts` (if it imports createStreamHandler)
- Modify: `libs/event-processor/src/index.ts` (remove `createEventHandler`/`createStreamHandler` from public exports)
- Modify: All 19 service event-listener files that import `createEventHandler` (update to pipeline imports — done in Phase 2)

- [ ] **Step 1: Move files**

```bash
mv libs/event-processor/src/pipelines/create-event-handler.ts libs/event-processor/src/engine/create-event-handler.ts
mv libs/event-processor/src/pipelines/create-stream-handler.ts libs/event-processor/src/engine/create-stream-handler.ts
```

- [ ] **Step 2: Update all internal imports**

In `libs/event-processor/src/pipelines/materialize-to-table.ts`: change import from `'./create-event-handler'` to `'../engine/create-event-handler'`.

In `libs/event-processor/src/pipelines/materialize-to-bucket.ts`: same change.

In `libs/event-processor/src/pipelines/change-data-capture.ts`: if it imports `createStreamHandler`, update path. (Check — it uses `StreamEngine` directly, may not need change.)

In `libs/event-processor/src/pipelines/replay-and-reduce.ts`: same check.

- [ ] **Step 3: Update pipeline barrel**

Rewrite `libs/event-processor/src/pipelines/index.ts`:

```ts
export { materializeToTable } from './materialize-to-table';
export type { MaterializeToTableConfig } from './materialize-to-table';
export { materializeToBucket } from './materialize-to-bucket';
export type { MaterializeToBucketConfig } from './materialize-to-bucket';
export { changeDataCapture } from './change-data-capture';
export type { ChangeDataCaptureConfig } from './change-data-capture';
export { replayAndReduce } from './replay-and-reduce';
export type { ReplayAndReduceConfig } from './replay-and-reduce';
```

No `createEventHandler` or `createStreamHandler` — they're internal now.

- [ ] **Step 4: Update main index.ts**

In `libs/event-processor/src/index.ts`:
- Remove the `createEventHandler` and `EventHandlerConfig` exports (lines 27-28)
- Remove the `createStreamHandler` and `StreamHandlerConfig` exports (lines 35-36)
- Add `materializeToBucket` and `MaterializeToBucketConfig` exports
- Add `changeDataCapture` and `ChangeDataCaptureConfig` exports

- [ ] **Step 5: Update test imports**

In `libs/event-processor/test/pipelines/create-event-handler.test.ts`: update import path to `../../src/engine/create-event-handler`.

In `libs/event-processor/test/pipelines/create-stream-handler.test.ts`: update import path.

Consider moving these test files to `test/engine/` as well for consistency.

- [ ] **Step 6: Run all event-processor tests**

Run: `pnpm nx test event-processor`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add libs/event-processor/
git commit -m "refactor(event-processor): move foundations to engine/, clean pipeline exports"
```

---

### Task 5: Add `toUow` helper export

**Files:**
- Create: `libs/event-processor/src/util/to-uow.ts`
- Modify: `libs/event-processor/src/index.ts`
- Test: `libs/event-processor/test/util/to-uow.test.ts`

- [ ] **Step 1: Write failing test**

Create `libs/event-processor/test/util/to-uow.test.ts`:

```ts
import { toUow } from '../../src/util/to-uow';
import type { EventPayload, EventContext } from '../../src';

describe('toUow', () => {
  const ctx: EventContext = {
    eventId: 'e1', eventType: 'TEST', tenantId: 't1',
    timestamp: '2026-01-01T00:00:00.000Z', receiveCount: 1, serviceName: 'test',
    record: {} as any,
  };

  it('should build UoW from payload and context', () => {
    const payload: EventPayload = { subject: { foo: 'bar' }, context: { tenantId: 't1' } };
    const uow = toUow(payload, ctx);
    expect(uow.event.id).toBe('e1');
    expect(uow.event.type).toBe('TEST');
    expect(uow.event.subject).toEqual({ foo: 'bar' });
    expect(uow.payload).toEqual({ foo: 'bar' });
  });

  it('should default context.tenantId from ctx when payload.context missing', () => {
    const payload: EventPayload = { subject: { foo: 'bar' } };
    const uow = toUow(payload, ctx);
    expect(uow.event.context).toEqual({ tenantId: 't1' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test event-processor -- --testPathPattern=to-uow`
Expected: FAIL

- [ ] **Step 3: Create to-uow.ts**

Create `libs/event-processor/src/util/to-uow.ts`:

```ts
import type { EventPayload } from '../types/handler-config';
import type { EventContext } from '../types/event-context';
import type { UnitOfWork, BusEvent } from '../platform';

export function toUow(payload: EventPayload, ctx: EventContext): UnitOfWork<BusEvent<Record<string, unknown>>> {
  const event: BusEvent<Record<string, unknown>> = {
    id: ctx.eventId,
    type: ctx.eventType,
    timestamp: ctx.timestamp,
    subject: payload.subject as Record<string, unknown>,
    context: payload.context ?? { tenantId: ctx.tenantId },
  };
  return { event, payload: payload.subject as Record<string, unknown>, record: {} };
}
```

- [ ] **Step 4: Export from index.ts**

Add to `libs/event-processor/src/index.ts`: `export { toUow } from './util/to-uow';`

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm nx test event-processor -- --testPathPattern=to-uow`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add libs/event-processor/src/util/to-uow.ts libs/event-processor/test/util/to-uow.test.ts libs/event-processor/src/index.ts
git commit -m "feat(event-processor): add toUow helper utility"
```

---

### Task 6: Create `resumeStateMachine` pipeline

**Files:**
- Create: `libs/event-processor/src/pipelines/resume-state-machine.ts`
- Modify: `libs/event-processor/src/pipelines/index.ts`
- Modify: `libs/event-processor/src/index.ts`
- Test: `libs/event-processor/test/pipelines/resume-state-machine.test.ts`

- [ ] **Step 1: Write failing test**

Create `libs/event-processor/test/pipelines/resume-state-machine.test.ts`:

```ts
import { resumeStateMachine } from '../../src/pipelines/resume-state-machine';
import { record } from '../../src/intents/record';
import { fakeSqsRecord } from '../../src/testing/fake-records';

const mockSfnSend = jest.fn().mockResolvedValue({});

jest.mock('@aws-sdk/client-sfn', () => ({
  SFNClient: jest.fn(() => ({ send: mockSfnSend })),
  SendTaskSuccessCommand: jest.fn((input) => ({ input, __type: 'SendTaskSuccessCommand' })),
  SendTaskFailureCommand: jest.fn((input) => ({ input, __type: 'SendTaskFailureCommand' })),
}));

describe('resumeStateMachine', () => {
  beforeEach(() => { mockSfnSend.mockClear(); });

  it('should call handler and send SendTaskSuccessCommand', async () => {
    const handler = resumeStateMachine({
      serviceName: 'test-svc',
      handlers: {
        TEST_EVENT: async () => ({
          output: { result: 'ok' },
        }),
      },
    });

    const sqsEvent = {
      Records: [fakeSqsRecord({
        type: 'TEST_EVENT',
        subject: { taskToken: 'token-123' },
        context: { tenantId: 't1' },
      })],
    };

    const result = await handler(sqsEvent as any);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockSfnSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ taskToken: 'token-123' }),
      }),
    );
  });

  it('should execute returned intents', async () => {
    const handler = resumeStateMachine({
      serviceName: 'test-svc',
      handlers: {
        TEST_EVENT: async () => ({
          output: { done: true },
          intents: [record('TestRecord', { foo: 'bar' })],
        }),
      },
    });

    const sqsEvent = {
      Records: [fakeSqsRecord({
        type: 'TEST_EVENT',
        subject: { taskToken: 'token-456' },
        context: { tenantId: 't1' },
      })],
    };

    const result = await handler(sqsEvent as any);
    expect(result.batchItemFailures).toHaveLength(0);
  });

  it('should send SendTaskFailureCommand on handler error', async () => {
    const handler = resumeStateMachine({
      serviceName: 'test-svc',
      handlers: {
        TEST_EVENT: async () => { throw new Error('agent failed'); },
      },
    });

    const sqsEvent = {
      Records: [fakeSqsRecord({
        type: 'TEST_EVENT',
        subject: { taskToken: 'token-789' },
        context: { tenantId: 't1' },
      })],
    };

    await handler(sqsEvent as any);
    expect(mockSfnSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          taskToken: 'token-789',
          error: 'agent failed',
        }),
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test event-processor -- --testPathPattern=resume-state-machine`
Expected: FAIL

- [ ] **Step 3: Implement resumeStateMachine pipeline**

Create `libs/event-processor/src/pipelines/resume-state-machine.ts`:

```ts
import type { SQSEvent, SQSBatchResponse, Context } from 'aws-lambda';
import { SFNClient, SendTaskSuccessCommand, SendTaskFailureCommand } from '@aws-sdk/client-sfn';
import { createEventHandler } from '../engine/create-event-handler';
import { NotRetryableError, logger } from '../internal';
import type { EventPayload } from '../types/handler-config';
import type { EventContext } from '../types/event-context';
import type { WriteIntent } from '../types/write-intent';
import { skip } from '../intents/skip';

export interface ResumeStateMachineConfig {
  serviceName: string;
  handlers: Record<string, ResumeHandler>;
  table?: string;
  bus?: string;
  errorEventType?: string;
}

export type ResumeHandler = (
  payload: EventPayload,
  ctx: EventContext,
) => Promise<{ output: Record<string, unknown>; intents?: WriteIntent[] }>;

export function resumeStateMachine(
  config: ResumeStateMachineConfig,
): (event: SQSEvent, context?: Context) => Promise<SQSBatchResponse> {
  const sfnClient = new SFNClient({});

  // Wrap each ResumeHandler into a standard HandlerFn
  const wrappedHandlers: Record<string, any> = {};

  for (const [eventType, resumeHandler] of Object.entries(config.handlers)) {
    wrappedHandlers[eventType] = async (payload: EventPayload, ctx: EventContext) => {
      const taskToken = payload.subject?.taskToken as string | undefined;
      if (!taskToken) {
        throw new NotRetryableError(`Missing taskToken in ${ctx.eventType} event ${ctx.eventId}`);
      }

      try {
        const result = await resumeHandler(payload, ctx);

        // Return intents for the engine to execute
        const intents = result.intents ?? [];

        // After intent execution, resume the state machine
        await sfnClient.send(new SendTaskSuccessCommand({
          taskToken,
          output: JSON.stringify(result.output),
        }));

        logger.info('State machine resumed', { eventType: ctx.eventType, taskToken: taskToken.slice(0, 20) });

        return intents.length > 0 ? intents : skip();
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));

        try {
          await sfnClient.send(new SendTaskFailureCommand({
            taskToken,
            error: err.message,
            cause: err.name,
          }));
        } catch (sfnError) {
          logger.error('Failed to send task failure to SFN', { sfnError, originalError: err.message });
        }

        throw error;
      }
    };
  }

  return createEventHandler({
    serviceName: config.serviceName,
    handlers: wrappedHandlers,
    table: config.table,
    bus: config.bus,
    errorEventType: config.errorEventType,
  });
}
```

- [ ] **Step 4: Export from pipeline barrel and main index.ts**

In `libs/event-processor/src/pipelines/index.ts`, add:
```ts
export { resumeStateMachine } from './resume-state-machine';
export type { ResumeStateMachineConfig, ResumeHandler } from './resume-state-machine';
```

In `libs/event-processor/src/index.ts`, add the same exports.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm nx test event-processor -- --testPathPattern=resume-state-machine`
Expected: PASS

- [ ] **Step 6: Run all event-processor tests**

Run: `pnpm nx test event-processor`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add libs/event-processor/
git commit -m "feat(event-processor): add resumeStateMachine pipeline"
```

---

### Task 7: Remove EditEvent schemas and types

**Files:**
- Modify: `libs/event-processor/src/domain/schemas.ts`
- Modify: `libs/event-processor/src/domain/index.ts`
- Modify: `libs/event-processor/src/index.ts`
- Modify: `libs/event-processor/test/domain/schemas.test.ts` (remove EditEvent tests if any)

- [ ] **Step 1: Remove EditEventSchema and EditOperationSchema from schemas.ts**

In `libs/event-processor/src/domain/schemas.ts`, remove lines 19-39 (EditOperationSchema, EditOperation, EditEventSchema, EditEvent).

- [ ] **Step 2: Remove exports from domain barrel**

In `libs/event-processor/src/domain/index.ts`, remove `EditEventSchema`, `EditOperationSchema` from the value exports and `EditEvent`, `EditOperation` from the type exports.

- [ ] **Step 3: Remove exports from main index.ts**

In `libs/event-processor/src/index.ts`, remove `EditEventSchema`, `EditOperationSchema` (line ~107-108) and `EditEvent`, `EditOperation` (line ~113-114).

- [ ] **Step 4: Update schema tests**

In `libs/event-processor/test/domain/schemas.test.ts`, remove any tests for EditEventSchema or EditOperationSchema.

- [ ] **Step 5: Run all event-processor tests**

Run: `pnpm nx test event-processor`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add libs/event-processor/
git commit -m "chore(event-processor): remove EditEvent schemas and types"
```

---

### Task 8: Run full workspace build to verify Phase 1

- [ ] **Step 1: Build event-processor**

Run: `pnpm nx build event-processor`
Expected: Build succeeds.

- [ ] **Step 2: Check for broken imports across workspace**

Run: `pnpm nx run-many -t build --all 2>&1 | head -100`

Expected: Some services will fail because they import `createEventHandler` directly (which is no longer exported) or import `EditEventSchema`/`EditOperationSchema`. This is expected — Phase 2 fixes these.

Note which services fail and verify they match the 19 handlers + 9 EditEvent repositories from the spec.

- [ ] **Step 3: Commit Phase 1 completion marker**

```bash
git commit --allow-empty -m "milestone: Phase 1 library overhaul complete"
```

---

## Phase 2: Service Rewrite

### Task 9: Remove EditEvent writes from all 9 repositories

**Files:** 9 repository files across 9 services. For each, remove:
- `editEvent()` helper functions
- `transactWrite` calls that atomically wrote `[data mutation, EditEvent]` — replace with single write (`.put()` or `.update()`)
- Any `EditEvent`/`EditEventSchema` imports

**Services and files:**
- `services/advisory/advisory-bff/src/repositories/advisory.repository.ts`
- `services/advisory/advisory-ctrl/src/repositories/decision.repository.ts`
- `services/advisory/compliance-ctrl/src/repositories/compliance.repository.ts`
- `services/advisory/decision-workflow-ctrl/src/repositories/decision-packet.repository.ts`
- `services/execution/execution-ctrl/src/repositories/order.repository.ts`
- `services/investor/investor-bff/src/repositories/investor-profile.repository.ts`
- `services/investor/investor-ctrl/src/repositories/notification.repository.ts`
- `services/investor/onboarding-agent-bff/src/repositories/onboarding.repository.ts`
- `services/ledger/reconciliation-ctrl/src/repositories/reconciliation.repository.ts`

- [ ] **Step 1: For each repository, read the file, identify transactWrite calls that include EditEvent, and replace them with single writes**

For each file:
1. Find `transactWrite` calls that have both a data write and an EditEvent Put
2. Remove the EditEvent Put from the transaction
3. If the transaction now has only one item, replace `transactWrite` with a direct `put()` or `update()` call
4. Remove the `editEvent()` helper function if it exists
5. Remove any `EditEvent`/`EditEventSchema` imports

- [ ] **Step 2: Run tests for all 9 affected services**

Run: `pnpm nx run-many -t test -p advisory-bff,advisory-ctrl,compliance-ctrl,decision-workflow-ctrl,execution-ctrl,investor-bff,investor-ctrl,onboarding-agent-bff,reconciliation-ctrl`
Expected: ALL PASS (repository tests should still pass since the data writes are unchanged — only the EditEvent side-writes are removed)

- [ ] **Step 3: Commit**

```bash
git add services/
git commit -m "chore: remove EditEvent writes from all 9 repositories"
```

---

### Task 10: Migrate BFF event-listeners to `materializeToTable` (4 services)

**Services:** investor-bff, advisory-bff, dashboard-bff, ledger-bff

For each BFF:
1. Read existing pipe classes to understand the transform logic
2. Create pure transform functions in `src/transforms/` directory
3. Rewrite `event-listener.ts` to use `materializeToTable` with object literal handlers
4. Write tests for transform functions
5. Delete pipe class files and the `src/pipes/` directory

**Files per service (investor-bff example):**
- Delete: `services/investor/investor-bff/src/pipes/user-registered.pipe.ts`
- Delete: `services/investor/investor-bff/src/pipes/notification-created.pipe.ts`
- Delete: `services/investor/investor-bff/src/pipes/balance-updated.pipe.ts`
- Create: `services/investor/investor-bff/src/transforms/user-registered.ts`
- Create: `services/investor/investor-bff/src/transforms/notification-created.ts`
- Create: `services/investor/investor-bff/src/transforms/balance-updated.ts`
- Rewrite: `services/investor/investor-bff/src/handlers/event-listener.ts`
- Create: `services/investor/investor-bff/test/transforms/user-registered.test.ts`
- Create: `services/investor/investor-bff/test/transforms/notification-created.test.ts`
- Create: `services/investor/investor-bff/test/transforms/balance-updated.test.ts`
- Delete: existing pipe test files (if any)

- [ ] **Step 1: Read each pipe class, understand what intent it maps to**

For each pipe, determine:
- Does it call `putIfNotExists`? → `record()` intent
- Does it call `put` (upsert)? → `project()` intent
- Does it call `guardedAtomicIncrement`? → `accumulate()` intent
- Does it call `update`? → `update()` intent

- [ ] **Step 2: Create transform functions for investor-bff**

Example `services/investor/investor-bff/src/transforms/user-registered.ts`:

```ts
import { record, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

export const userRegistered = (uow: UnitOfWork<BusEvent<Record<string, unknown>>>): WriteIntent =>
  record('InvestorProfile', {
    tenantId: (uow.event.context as Record<string, string>).tenantId,
    userId: uow.event.subject.userId,
    email: uow.event.subject.email,
  });
```

- [ ] **Step 3: Write tests for transform functions**

Example `services/investor/investor-bff/test/transforms/user-registered.test.ts`:

```ts
import { record } from '@nestfolio/event-processor';
import { userRegistered } from '../../src/transforms/user-registered';

describe('userRegistered', () => {
  it('should return record intent for InvestorProfile', () => {
    const uow = {
      event: {
        id: 'e1', type: 'USER_REGISTERED', timestamp: '2026-01-01T00:00:00.000Z',
        subject: { userId: 'u1', email: 'a@b.c' },
        context: { tenantId: 't1' },
      },
      payload: { userId: 'u1', email: 'a@b.c' },
      record: {},
    };
    expect(userRegistered(uow as any)).toEqual(
      record('InvestorProfile', { tenantId: 't1', userId: 'u1', email: 'a@b.c' }),
    );
  });
});
```

- [ ] **Step 4: Rewrite event-listener.ts for investor-bff**

```ts
import { materializeToTable, toUow } from '@nestfolio/event-processor';
import { InvestorBffEventTypes } from '../domain/events';
import { InvestorCtrlEventTypes } from '@nestfolio/investor-ctrl/events';
import { LedgerCrossDomainEventTypes } from '@nestfolio/ledger-adpt/domain';
import { userRegistered } from '../transforms/user-registered';
import { notificationCreated } from '../transforms/notification-created';
import { balanceUpdated } from '../transforms/balance-updated';

export const handler = materializeToTable({
  serviceName: 'investor-bff',
  handlers: {
    [InvestorBffEventTypes.USER_REGISTERED]: (payload, ctx) =>
      userRegistered(toUow(payload, ctx)),
    [InvestorCtrlEventTypes.NOTIFICATION_CREATED]: (payload, ctx) =>
      notificationCreated(toUow(payload, ctx)),
    [LedgerCrossDomainEventTypes.BALANCE_UPDATED]: (payload, ctx) =>
      balanceUpdated(toUow(payload, ctx)),
  },
  errorEventType: 'INVESTOR_BFF_FAILED',
});
```

- [ ] **Step 5: Delete pipe class files**

Delete all `.pipe.ts` files and their test files for investor-bff.

- [ ] **Step 6: Run tests for investor-bff**

Run: `pnpm nx test investor-bff`
Expected: ALL PASS

- [ ] **Step 7: Repeat steps 2-6 for advisory-bff, dashboard-bff, ledger-bff**

For dashboard-bff and ledger-bff, note that handlers may return arrays of intents (fan-out pattern). Remove `NamedPipe` interface, `eventPipeMap`, and `Object.fromEntries` handler building.

- [ ] **Step 8: Run tests for all 4 BFF services**

Run: `pnpm nx run-many -t test -p investor-bff,advisory-bff,dashboard-bff,ledger-bff`
Expected: ALL PASS

- [ ] **Step 9: Commit**

```bash
git add services/
git commit -m "refactor: migrate 4 BFF event-listeners to materializeToTable with transforms"
```

---

### Task 11: Migrate ctrl event-listeners to `materializeToTable` (6 services)

**Services:** advisory-ctrl, compliance-ctrl, execution-ctrl, investor-ctrl, broker-adpt, reconciliation-ctrl

These services have inline business logic (not pipes). The handler logic stays mostly the same, but instead of calling repositories, handlers return intents.

For each service:
1. Read the current event-listener to understand what each handler does
2. Rewrite handlers to return intents (`record`, `project`, `update`, `accumulate`)
3. Replace `createEventHandler` with `materializeToTable`
4. Remove `EventListenerDeps`, `createHandlers(deps)`, production wiring section, repository/service imports
5. Remove custom `toEvent()` helpers (advisory-ctrl, execution-ctrl)
6. Update tests

- [ ] **Step 1: Migrate investor-ctrl** (simplest — all handlers call one service)

Read `services/investor/investor-ctrl/src/handlers/event-listener.ts`. All event types call `lifecycleService.executeNotificationLifecycle`. This becomes a `record('Notification', {...})` intent for each.

- [ ] **Step 2: Migrate reconciliation-ctrl** (simple — one handler function mapped to multiple events)

All events call `reconciliationService.reconcile`. This becomes `record('ReconciliationResult', {...})`.

- [ ] **Step 3: Migrate execution-ctrl**

Remove custom `toEvent()` helper. Replace service calls with `record`/`update` intents.

- [ ] **Step 4: Migrate advisory-ctrl**

Remove custom `toEvent()` helper. `handleTriggerEvent` → `record('DecisionPacket', {...})`. `processComplianceCallback` → `update('DecisionPacket', {...})`. `processUserResponse` → `update('DecisionPacket', {...})`. Remove `for`-loop handler building.

- [ ] **Step 5: Migrate compliance-ctrl**

`processDecisionPacket` returns `[record('ComplianceCheck', {...}), record('AuditArtifact', {...})]`. `processMandateEvent` returns `project('MandateSnapshot', {...})`. Remove `for`-loop handler building.

- [ ] **Step 6: Migrate broker-adpt**

Complex simulation logic stays in the handler (it's business logic, not just a write). Handler calls `simulationEngine` and returns intents for the DDB writes. The `createHandlers(deps)` pattern stays here because of the `SimulationEngineService` dependency.

- [ ] **Step 7: Update tests for all 6 services**

Replace handler integration tests with intent assertion tests where possible. For broker-adpt, keep dependency injection tests.

- [ ] **Step 8: Run tests for all 6 ctrl services**

Run: `pnpm nx run-many -t test -p advisory-ctrl,compliance-ctrl,execution-ctrl,investor-ctrl,broker-adpt,reconciliation-ctrl`
Expected: ALL PASS

- [ ] **Step 9: Commit**

```bash
git add services/
git commit -m "refactor: migrate 6 ctrl event-listeners to materializeToTable"
```

---

### Task 12: Migrate agent services to `resumeStateMachine` (4 services)

**Services:** investor-profile-ctrl, portfolio-engine-ctrl, advisory-narrative-ctrl, market-intelligence-ctrl

For each:
1. Replace `createEventHandler` with `resumeStateMachine`
2. Change handler return type to `{ output, intents? }`
3. Remove manual `skip()` returns
4. Remove imperative `handlers[x] = ...` pattern → use object literal
5. Keep `createHandlers(deps)` because of agent/memory deps

- [ ] **Step 1: Migrate investor-profile-ctrl**

Rewrite `services/advisory/investor-profile-ctrl/src/handlers/event-listener.ts`:

```ts
import { resumeStateMachine, record, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { createMemoryClient, createNoOpMemoryClient, type MemoryClient } from '@nestfolio/agent-orchestrator';
import { createAgentService } from '../agent-service';
// ... production wiring stays (agentService, memoryClient are real deps)

export interface SfnCallbackDeps {
  readonly agentService: { runPipeline: (event: Record<string, unknown>) => Promise<Record<string, unknown>> };
  readonly memoryClient: MemoryClient;
}

export const createHandlers = (deps: SfnCallbackDeps) => ({
  ANALYZE_INVESTOR_PROFILE: async (payload: EventPayload, ctx: EventContext) => {
    const subject = payload.subject ?? {};
    const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
    const decisionId = subject.decisionId as string;

    const session = deps.memoryClient.openDecisionSession(tenantId, decisionId);
    const tenantHistory = await session.searchLongTermMemory('investor preferences risk tolerance');

    const result = await deps.agentService.runPipeline({
      tenantId, decisionId,
      investorProfile: subject.investorProfile ?? subject.context ?? {},
      portfolioState: subject.portfolioState ?? {},
      tenantHistory: tenantHistory.map(r => r.content),
    });

    await session.writeAgentOutput(result);

    return {
      output: { decisionId, tenantId },
      intents: [record('AgentInvocation', { decisionId, tenantId, agentName: 'investor-profile' })],
    };
  },
});

// Production wiring
const deps = { agentService: createAgentService(...), memoryClient: ... };

export const handler = resumeStateMachine({
  serviceName: 'investor-profile-ctrl',
  handlers: createHandlers(deps),
  errorEventType: 'INVESTOR_PROFILE_CTRL_FAILED',
});
```

- [ ] **Step 2: Repeat for portfolio-engine-ctrl, advisory-narrative-ctrl, market-intelligence-ctrl**

Same pattern. Each has 1-2 handlers. Replace imperative `handlers[x] = ...` with object literal. Change return type to `{ output, intents? }`. Remove the manual EventBridge publish (the pipeline handles SFN resume; CDC handles event publishing from DDB writes).

- [ ] **Step 3: Update tests for all 4 agent services**

Mock agent service + memory client. Assert `{ output, intents }` structure.

- [ ] **Step 4: Run tests for all 4 agent services**

Run: `pnpm nx run-many -t test -p investor-profile-ctrl,portfolio-engine-ctrl,advisory-narrative-ctrl,market-intelligence-ctrl`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add services/advisory/
git commit -m "refactor: migrate 4 agent services to resumeStateMachine"
```

---

### Task 13: Split decision-workflow-ctrl (materializeToTable + resumeStateMachine)

**Files:**
- Rewrite: `services/advisory/decision-workflow-ctrl/src/handlers/event-listener.ts` → `materializeToTable` for trigger events
- Create: `services/advisory/decision-workflow-ctrl/src/handlers/sfn-callback.ts` → `resumeStateMachine` for resume events
- Modify: CDK stack to add EventBridge rule for SFN start
- Modify: `services/advisory/advisory-hub/src/service.stack.ts`
- Modify: `services/advisory/decision-workflow-ctrl/src/service.stack.ts` (if separate)

- [ ] **Step 1: Split handlers into two files**

`event-listener.ts` (materializeToTable): handles trigger events → returns `record('WorkflowTrigger', {...})` intents. No SFN SDK needed.

`sfn-callback.ts` (resumeStateMachine): handles AGENT_COMPLETION, COMPLIANCE, USER_RESPONSE events → returns `{ output, intents? }`. Pipeline handles SFN resume.

- [ ] **Step 2: Update event-listener.ts**

```ts
import { materializeToTable, record, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { TRIGGER_EVENT_TYPES } from '../domain/events';

const triggerHandler = (payload: EventPayload, ctx: EventContext) => {
  const tenantId = (payload.subject?.tenantId as string) ?? ctx.tenantId;
  return record('WorkflowTrigger', {
    tenantId,
    trigger: ctx.eventType,
    triggerEventId: ctx.eventId,
    context: payload.subject ?? {},
  });
};

export const handler = materializeToTable({
  serviceName: 'decision-workflow-ctrl',
  handlers: Object.fromEntries(
    TRIGGER_EVENT_TYPES.map(type => [type, triggerHandler]),
  ),
  errorEventType: 'DECISION_WORKFLOW_FAILED',
});
```

- [ ] **Step 3: Create sfn-callback.ts**

```ts
import { resumeStateMachine, record, update, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { AGENT_COMPLETION_EVENT_TYPES, COMPLIANCE_EVENT_TYPES, USER_RESPONSE_EVENT_TYPES } from '../domain/events';

const createHandlers = () => {
  const handlers: Record<string, any> = {};

  for (const type of AGENT_COMPLETION_EVENT_TYPES) {
    handlers[type] = async (payload: EventPayload, ctx: EventContext) => {
      const subject = payload.subject ?? {};
      return {
        output: { decisionId: subject.decisionId },
        intents: [record('AgentOutput', { decisionId: subject.decisionId, eventType: ctx.eventType })],
      };
    };
  }

  for (const type of COMPLIANCE_EVENT_TYPES) {
    handlers[type] = async (payload: EventPayload, ctx: EventContext) => {
      const subject = payload.subject ?? {};
      const isApproved = ctx.eventType === 'DECISION_APPROVED';
      const decision = isApproved ? 'APPROVED' : 'BLOCKED';
      const authorityLevel = (subject.authorityLevel as string) ?? 'L2';
      return {
        output: { decision, authorityLevel },
        intents: subject.decisionId ? [update('DecisionPacket', {
          status: isApproved ? (authorityLevel === 'L1' ? 'APPROVED' : 'AWAITING_CONFIRMATION') : 'BLOCKED',
          complianceResult: decision,
          authorityLevel,
        }, { overrides: { pk: `DecisionPacket#${ctx.tenantId}#${subject.decisionId}`, sk: 'DecisionPacket' } })] : [],
      };
    };
  }

  for (const type of USER_RESPONSE_EVENT_TYPES) {
    handlers[type] = async (payload: EventPayload, ctx: EventContext) => {
      const subject = payload.subject ?? {};
      const isConfirmed = ctx.eventType === 'USER_CONFIRMED';
      const decision = isConfirmed ? 'CONFIRMED' : 'REJECTED';
      return {
        output: { decision },
        intents: subject.decisionId ? [update('DecisionPacket', {
          status: decision,
          userDecision: decision,
        }, { overrides: { pk: `DecisionPacket#${ctx.tenantId}#${subject.decisionId}`, sk: 'DecisionPacket' } })] : [],
      };
    };
  }

  return handlers;
};

export const handler = resumeStateMachine({
  serviceName: 'decision-workflow-ctrl',
  handlers: createHandlers(),
  errorEventType: 'DECISION_WORKFLOW_FAILED',
});
```

- [ ] **Step 4: Add EventBridge rule in CDK for SFN start**

In the advisory-hub CDK stack, add:

```ts
const startRule = new events.Rule(this, 'StartDecisionWorkflow', {
  eventBus: advisoryBus,
  eventPattern: { detailType: ['WORKFLOW_TRIGGER_CREATED'] },
});
startRule.addTarget(new targets.SfnStateMachine(decisionStateMachine, {
  input: events.RuleTargetInput.fromEventPath('$.detail'),
}));
```

- [ ] **Step 5: Update CDK stack to register sfn-callback Lambda**

Add a second Lambda function entry for the `sfn-callback.ts` handler. Grant it SFN permissions (`sfn:SendTaskSuccess`, `sfn:SendTaskFailure`).

- [ ] **Step 6: Update tests**

- [ ] **Step 7: Run tests**

Run: `pnpm nx test decision-workflow-ctrl`
Expected: ALL PASS

- [ ] **Step 8: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/ services/advisory/advisory-hub/
git commit -m "refactor: split decision-workflow-ctrl into materializeToTable + resumeStateMachine"
```

---

### Task 14: Migrate kb-ingestion-handlers to `materializeToBucket` (3 services)

**Services:** investor-profile-ctrl, portfolio-engine-ctrl, market-intelligence-ctrl

- [ ] **Step 1: Migrate investor-profile-ctrl kb-ingestion-handler**

Rewrite `services/advisory/investor-profile-ctrl/src/handlers/kb-ingestion-handler.ts` to use `materializeToBucket`. Handlers return `store()` intents and call Bedrock imperatively.

- [ ] **Step 2: Migrate portfolio-engine-ctrl kb-ingestion-handler**

Same pattern.

- [ ] **Step 3: Migrate market-intelligence-ctrl kb-ingestion-handler**

Same pattern. This one has 5 event types.

- [ ] **Step 4: Update tests for all 3 services**

- [ ] **Step 5: Run tests**

Run: `pnpm nx run-many -t test -p investor-profile-ctrl,portfolio-engine-ctrl,market-intelligence-ctrl`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add services/advisory/
git commit -m "refactor: migrate 3 kb-ingestion-handlers to materializeToBucket"
```

---

### Task 15: Migrate ledger-ctrl reducer to `replayAndReduce`

**Files:**
- Rewrite: `services/ledger/ledger-ctrl/src/handlers/reducer.ts`
- Modify: CDK stack if needed for the new Lambda configuration

- [ ] **Step 1: Read existing reducer.ts to understand current snapshot logic**

Verify that `accountReducer` and `initialAccountState` exist in `services/ledger/ledger-ctrl/src/domain/account.reducer.ts` and are compatible with `replayAndReduce`.

- [ ] **Step 2: Rewrite reducer.ts**

```ts
import { replayAndReduce } from '@nestfolio/event-processor';
import { accountReducer, initialAccountState } from '../domain/account.reducer';

export const handler = replayAndReduce({
  serviceName: 'ledger-ctrl',
  groupBy: { key: (record) => `${record.tenantId}#${record.streamType}` },
  filter: (record) => record.__typename === 'LedgerEntry',
  reducer: accountReducer,
  initialState: initialAccountState,
  snapshot: {
    key: (groupKey) => ({ pk: `Snapshot#${groupKey}`, sk: 'AccountState' }),
    daily: true,
  },
});
```

- [ ] **Step 3: Run tests**

Run: `pnpm nx test ledger-ctrl`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add services/ledger/ledger-ctrl/
git commit -m "refactor: migrate ledger-ctrl reducer to replayAndReduce pipeline"
```

---

### Task 16: Migrate ledger-ctrl event-listener to `materializeToTable`

**Files:**
- Rewrite: `services/ledger/ledger-ctrl/src/handlers/event-listener.ts`

- [ ] **Step 1: Read current handler to map operations to intents**

`processActualEvent` → `record('LedgerEntry', {...})` with sequence number. Note: `nextSequence()` is an atomic counter — the handler may need to keep calling `repository.nextSequence()` imperatively and then return a `record()` intent with the sequence number. The `createHandlers(deps)` pattern stays for this service.

`processSimulationEvent` → loop returning `record('LedgerEntry', {...})` per trade. Same issue with `nextSequence`.

- [ ] **Step 2: Rewrite event-listener.ts**

Keep `createHandlers(deps)` because of `repository.nextSequence()` and `shadowFill` deps. Replace `createEventHandler` with `materializeToTable`. Handlers return `record()` intents instead of calling `repository.putLedgerEntry()`.

- [ ] **Step 3: Run tests**

Run: `pnpm nx test ledger-ctrl`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add services/ledger/ledger-ctrl/
git commit -m "refactor: migrate ledger-ctrl event-listener to materializeToTable"
```

---

### Task 17: Final verification — full workspace build and test

- [ ] **Step 1: Build all projects**

Run: `pnpm nx run-many -t build --all`
Expected: ALL PASS — no more broken imports

- [ ] **Step 2: Run all tests**

Run: `pnpm nx run-many -t test --all`
Expected: ALL PASS

- [ ] **Step 3: Verify no service imports createEventHandler directly**

Run: `grep -r "from.*event-processor.*createEventHandler\|from.*event-processor.*createStreamHandler" services/ --include="*.ts" | grep -v node_modules | grep -v ".d.ts"`
Expected: No results

- [ ] **Step 4: Verify no EditEvent references remain**

Run: `grep -r "EditEvent\|editEvent\|EditOperation\|EditOperationSchema" services/ libs/ --include="*.ts" | grep -v node_modules | grep -v ".d.ts" | grep -v "test/" | grep -v ".test.ts"`
Expected: No results

- [ ] **Step 5: Verify no s3Put references remain**

Run: `grep -r "s3Put\|s3-put\|S3PutIntent" libs/ --include="*.ts" | grep -v node_modules | grep -v ".d.ts"`
Expected: No results

- [ ] **Step 6: Commit completion marker**

```bash
git commit --allow-empty -m "milestone: Pipeline standardization complete — all 19 handlers migrated"
```
