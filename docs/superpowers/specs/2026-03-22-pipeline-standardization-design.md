# Pipeline Standardization Design

## Problem

The `@nestfolio/event-processor` library provides 6 pipeline abstractions, but services bypass them entirely. All 16 event-listeners call `createEventHandler` directly (a low-level foundation), return `skip()` from every handler, and perform manual DDB writes via repository classes. The intent system (`record`, `project`, `accumulate`) is unused. Three pipelines (`materializeToTable`, `materializeToBucket`, `replayAndReduce`) have zero consumers. The `s3Put` intent executor is unimplemented.

Additionally, event-listener code style is inconsistent: 8 of 16 use imperative `for`-loop or `handlers[x] = ...` handler map construction, 2 use custom `toEvent()` helpers with fallback defaults, and services mix inline business logic with repository calls instead of using declarative patterns.

## Goals

1. Every event-listener uses a **named pipeline** (`materializeToTable`, `resumeStateMachine`) instead of `createEventHandler` directly
2. Handlers return **intents** (`record`, `project`, `update`, `accumulate`, `store`) instead of manual DDB writes + `skip()`
3. Pipe classes replaced by **pure transform functions** returning intents
4. EditEvent audit trail removed — CDC stream serves as the change log
5. `createEventHandler` / `createStreamHandler` moved from `pipelines/` to `engine/` (internal foundations, not public API)
6. Consistent code style: object literal handler maps, standardized `toUow()` helper

## Non-Goals

- Changing event-publisher implementations (most already use `changeDataCapture` correctly)
- Migrating the 5 data adapter publishers (scheduled fetchers, no pipeline applies)
- Backward compatibility (system not deployed)

---

## Architecture

### Layer Separation

```
Services
  └── import named pipelines only

Pipelines (public API — declarative, semantic)
  ├── materializeToTable     SQS → handler → intents → DDB writes
  ├── materializeToBucket    SQS → handler → store intent → S3 writes
  ├── resumeStateMachine     SQS → handler → SFN callback + optional intents
  ├── changeDataCapture      DDB Stream → EventBridge events
  └── replayAndReduce        DDB Stream → snapshot rebuild via reducer

Foundations (internal — imperative, generic)
  ├── createEventHandler     creates BatchEngine + middleware (used by SQS pipelines)
  └── createStreamHandler    creates StreamEngine (used by stream pipelines)

Engine
  ├── BatchEngine            SQS record processing, routing, error collection
  ├── StreamEngine           DDB stream record processing, grouping, filtering
  └── IntentExecutor         executes WriteIntent → DDB/S3 operations
```

### Pipeline → Service Mapping

| Pipeline | Services |
|---|---|
| `materializeToTable` | investor-bff, advisory-bff, dashboard-bff, ledger-bff, advisory-ctrl, compliance-ctrl, execution-ctrl, investor-ctrl, broker-adpt, reconciliation-ctrl |
| `resumeStateMachine` | decision-workflow-ctrl (resume handlers), investor-profile-ctrl, portfolio-engine-ctrl, advisory-narrative-ctrl, market-intelligence-ctrl |
| `changeDataCapture` | All 14 services with DDB streams (already used, no change) |
| `replayAndReduce` | ledger-ctrl (new stream Lambda, replaces manual `reducer.ts`) |
| `materializeToBucket` | No current service (available for future use) |

### decision-workflow-ctrl Split

Currently this service mixes two concerns: starting SFN executions (imperative `StartExecutionCommand`) and resuming them (imperative `SendTaskSuccessCommand`).

After:
- **SFN start**: handler returns `record('WorkflowTrigger', {...})` → CDC publishes `WORKFLOW_TRIGGER_CREATED` → EventBridge rule targets state machine (CDK infrastructure)
- **SFN resume**: `resumeStateMachine` pipeline handles `SendTaskSuccessCommand` / `SendTaskFailureCommand` automatically

The event-listener becomes a `materializeToTable` handler (trigger events → record intents). A separate `sfn-callback` Lambda uses `resumeStateMachine` for agent completion, compliance, and user response events.

---

## Intent System

### Current Intents

| Intent | Tag | Operation | Status |
|---|---|---|---|
| `record()` | `record` | Idempotent PutItem (`attribute_not_exists`) | Exists, works |
| `project()` | `project` | PutItem upsert (overwrites) | Exists, works |
| `accumulate()` | `accumulate` | Guarded atomic increment | Exists, works |
| `s3Put()` | `s3-put` | S3 PutObject | Exists, **executor is stub** |
| `skip()` | `skip` | No-op | Exists, works |

### After

| Intent | Tag | Operation | Status |
|---|---|---|---|
| `record()` | `record` | Idempotent PutItem (`attribute_not_exists`) | Unchanged |
| `project()` | `project` | PutItem upsert (overwrites) | Unchanged |
| `accumulate()` | `accumulate` | Guarded atomic increment | Unchanged |
| `update()` | `update` | UpdateCommand (partial update) | **NEW** |
| `store()` | `store` | S3 PutObject | **RENAME** from `s3Put`, **IMPLEMENT** executor |
| `skip()` | `skip` | No-op | Unchanged |

### New `UpdateIntent`

```ts
export interface UpdateIntent {
  readonly _tag: 'update';
  readonly typename: string;
  readonly updates: Record<string, unknown>;  // fields to SET
  readonly removes?: string[];                // fields to REMOVE
  readonly condition?: string;                // optional ConditionExpression
  readonly overrides?: KeyOverrides;
}
```

The `IntentExecutor` builds an `UpdateCommand` dynamically:
- `SET #f1 = :v1, #f2 = :v2` from `updates` entries
- `REMOVE #f3, #f4` from `removes` array
- Always adds `updatedAt = ctx.timestamp`
- Uses `ExpressionAttributeNames` to avoid reserved word conflicts

### Renamed `StoreIntent`

```ts
export interface StoreIntent {
  readonly _tag: 'store';
  readonly body: unknown;
  readonly key?: string;
  readonly format?: 'json' | 'csv';
}
```

Default key convention: `{serviceName}/{eventType}/{eventId}.{format}`.

The `IntentExecutor` uses `S3Client.putObject`. JSON bodies are `JSON.stringify`-ed, CSV bodies use the existing `toCsv` utility.

### Intent Helpers

```ts
// New
export const update = (typename: string, updates: Record<string, unknown>, overrides?: KeyOverrides): UpdateIntent =>
  ({ _tag: 'update', typename, updates, overrides });

// Renamed
export const store = (body: unknown, options?: { key?: string; format?: 'json' | 'csv' }): StoreIntent =>
  ({ _tag: 'store', body, ...options });
```

---

## New Pipeline: `resumeStateMachine`

### Config

```ts
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
```

### Behavior

1. Parses SQS record, extracts `taskToken` from `payload.subject.taskToken`
2. Builds `EventContext` (same as `materializeToTable`)
3. Calls the matched handler
4. Executes any returned `intents` via `IntentExecutor`
5. Calls `SendTaskSuccessCommand({ taskToken, output: JSON.stringify(handler.output) })`
6. On handler error: calls `SendTaskFailureCommand({ taskToken, error: err.message, cause: err.name })`
7. If no `taskToken` in payload: treats as `NotRetryableError` (logs + drops, no SFN call)

### Implementation

Internally uses `createEventHandler` (foundation) with a wrapper that intercepts handler results, extracts SFN output, and calls the SFN client after intent execution.

---

## Handler Migration Patterns

### Pattern A: Pure intent handlers (`materializeToTable`)

For services where handlers have no side effects beyond DDB writes. Covers 10 services.

**Before** (investor-bff with Pipe class):
```ts
// user-registered.pipe.ts
export class UserRegisteredPipe implements Pipe<...> {
  constructor(private readonly repository: InvestorProfileRepository) {}
  async process(uow) {
    await this.repository.createProfile(tenantId, userId, email, event.id);
  }
}

// event-listener.ts
export const createHandlers = (deps: EventListenerDeps) => ({
  [InvestorBffEventTypes.USER_REGISTERED]: async (payload, ctx) => {
    await deps.userRegisteredPipe.process(toUow(payload, ctx));
    return skip();
  },
});

const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new InvestorProfileRepository(TABLE_NAME, dynamoClient);
const deps = { userRegisteredPipe: new UserRegisteredPipe(repository), ... };

export const handler = createEventHandler({
  serviceName: 'investor-bff',
  handlers: createHandlers(deps),
  table: TABLE_NAME,
  bus: requireEnv('BUS_NAME'),
  errorEventType: 'INVESTOR_BFF_FAILED',
});
```

**After**:
```ts
// transforms/user-registered.ts
export const userRegistered = (uow: UnitOfWork): WriteIntent =>
  record('InvestorProfile', {
    tenantId: uow.event.context.tenantId,
    userId: uow.event.subject.userId,
    email: uow.event.subject.email,
  });

// event-listener.ts
import { materializeToTable, record, toUow } from '@nestfolio/event-processor';
import { userRegistered } from '../transforms/user-registered';

export const handler = materializeToTable({
  serviceName: 'investor-bff',
  handlers: {
    [InvestorBffEventTypes.USER_REGISTERED]: (payload, ctx) =>
      userRegistered(toUow(payload, ctx)),
  },
  errorEventType: 'INVESTOR_BFF_FAILED',
});
```

No `createHandlers(deps)` factory, no `EventListenerDeps` interface, no DynamoDBClient instantiation, no repository import, no production wiring section.

**Before** (advisory-ctrl with inline logic + transactWrite):
```ts
async function processComplianceCallback(deps, payload, ctx) {
  if (ctx.eventType === 'DECISION_APPROVED') {
    if (authorityLevel === 'L1') {
      await deps.repository.updateDecisionStatus(tenantId, dpId, 'APPROVED', { ... });
    } else {
      await deps.repository.updateDecisionStatus(tenantId, dpId, 'AWAITING_CONFIRMATION', { ... });
    }
  } else if (ctx.eventType === 'DECISION_BLOCKED') {
    await deps.repository.updateDecisionStatus(tenantId, dpId, 'BLOCKED', { ... });
  }
  return skip();
}
```

**After**:
```ts
[ComplianceEventTypes.DECISION_APPROVED]: (payload, ctx) => {
  const { decisionId, authorityLevel } = payload.subject;
  const pk = `DecisionPacket#${ctx.tenantId}#${decisionId}`;
  return update('DecisionPacket', {
    status: authorityLevel === 'L1' ? 'APPROVED' : 'AWAITING_CONFIRMATION',
    authorityLevel,
    ...(authorityLevel === 'L1'
      ? { approvedAt: ctx.timestamp }
      : { confirmationRequired: true }),
  }, { pk, sk: 'DecisionPacket' });
},
```

**Before** (dashboard-bff with eventPipeMap fan-out):
```ts
const EVENT_PIPE_MAP = {
  [LedgerCrossDomainEventTypes.BALANCE_UPDATED]: [
    { name: 'portfolioSummary', pipe: portfolioSummaryPipe },
    { name: 'recentActivity', pipe: recentActivityPipe },
  ],
};
```

**After**:
```ts
[LedgerCrossDomainEventTypes.BALANCE_UPDATED]: (payload, ctx) => [
  portfolioSummary(toUow(payload, ctx)),
  recentActivity(toUow(payload, ctx)),
],
```

Each transform function is a pure function returning `WriteIntent | WriteIntent[]`.

### Pattern B: SFN callback handlers (`resumeStateMachine`)

For services with side effects (agent pipelines, memory client). Covers 5 services.

```ts
import { resumeStateMachine, record } from '@nestfolio/event-processor';

export interface SfnCallbackDeps {
  readonly agentService: { runPipeline: (...) => Promise<...> };
  readonly memoryClient: MemoryClient;
}

export const createHandlers = (deps: SfnCallbackDeps) => ({
  ANALYZE_INVESTOR_PROFILE: async (payload: EventPayload, ctx: EventContext) => {
    const { decisionId, tenantId } = payload.subject;
    const session = deps.memoryClient.openDecisionSession(tenantId, decisionId);
    const history = await session.searchLongTermMemory('investor preferences');
    const result = await deps.agentService.runPipeline({ tenantId, decisionId, history });
    await session.writeAgentOutput(result);
    return {
      output: { decisionId, tenantId },
      intents: [record('AgentInvocation', { decisionId, tenantId, agentName: 'investor-profile', ... })],
    };
  },
});

// Production wiring (still needed — real deps)
const deps = { agentService: createAgentService(...), memoryClient: createMemoryClient(...) };

export const handler = resumeStateMachine({
  serviceName: 'investor-profile-ctrl',
  handlers: createHandlers(deps),
  errorEventType: 'INVESTOR_PROFILE_CTRL_FAILED',
});
```

The `createHandlers(deps)` pattern stays here because agent services have real side-effect dependencies that need injection for testing.

### Pattern C: Snapshot reducer (`replayAndReduce`)

Replaces ledger-ctrl's manual `reducer.ts` handler.

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

### `toUow` Helper

Standardized in event-processor, used by all `materializeToTable` handlers:

```ts
export function toUow(payload: EventPayload, ctx: EventContext): UnitOfWork {
  return {
    event: {
      id: ctx.eventId,
      type: ctx.eventType,
      timestamp: ctx.timestamp,
      subject: payload.subject,
      context: payload.context ?? { tenantId: ctx.tenantId },
    },
    payload: payload.subject as Record<string, unknown>,
    record: {},
  };
}
```

Exported from `@nestfolio/event-processor`. Replaces per-service `toUow()` and `toEvent()` definitions.

---

## Infrastructure Changes (CDK)

### decision-workflow-ctrl: SFN Start via EventBridge Rule

Remove `StartExecutionCommand` from handler code. The trigger handler writes a `WorkflowTrigger` record → CDC publishes `WORKFLOW_TRIGGER_CREATED` → EventBridge rule starts SFN.

```ts
// In advisory-hub CDK stack
const startRule = new events.Rule(this, 'StartDecisionWorkflow', {
  eventBus: advisoryBus,
  eventPattern: { detailType: ['WORKFLOW_TRIGGER_CREATED'] },
});
startRule.addTarget(new targets.SfnStateMachine(decisionStateMachine, {
  input: events.RuleTargetInput.fromEventPath('$.detail'),
}));
```

### ledger-ctrl: New Reducer Lambda

Add a second DDB stream consumer Lambda using `replayAndReduce`. The existing CDC publisher Lambda continues unchanged on the same stream.

```ts
// In execution-hub CDK stack
const reducerFn = new lambda.Function(this, 'LedgerReducer', {
  handler: 'reducer.handler',
  ...defaultLambdaProps,
});
ledgerTable.grantReadWriteData(reducerFn);
reducerFn.addEventSource(new DynamoEventSource(ledgerTable, {
  startingPosition: lambda.StartingPosition.TRIM_HORIZON,
  batchSize: 100,
  filterCriteria: { filters: [{ pattern: JSON.stringify({ eventName: ['INSERT'] }) }] },
}));
```

---

## Deletions

### From `@nestfolio/event-processor`

| What | Location |
|---|---|
| `EditEventSchema`, `EditOperationSchema` | `src/domain/schemas.ts` |
| `EditEvent`, `EditOperation` type exports | `src/domain/index.ts`, `src/index.ts` |
| `s3Put` intent helper | Renamed to `store` in `src/intents/` |
| `s3-put` tag constant | Updated to `store` in `write-intent.ts` |
| `createEventHandler` public export | Removed from `src/index.ts` (stays in `src/engine/`) |
| `createStreamHandler` public export | Removed from `src/index.ts` (stays in `src/engine/`) |

### From services

| What | Count | Services |
|---|---|---|
| Pipe class files (`.pipe.ts`) | 14 files | investor-bff (3), advisory-bff (2), dashboard-bff (6), ledger-bff (3) |
| `editEvent()` helper functions | 4 repositories | advisory-ctrl, execution-ctrl, reconciliation-ctrl, onboarding-agent-bff |
| `transactWrite` calls for EditEvents | ~10 calls | Same 4 services |
| `EventListenerDeps` interfaces (pure handlers) | 10 services | All `materializeToTable` services |
| `createHandlers(deps)` factories (pure handlers) | 10 services | Same |
| Production wiring sections (DynamoDBClient, repo instantiation) | 10 services | Same |
| Custom `toEvent()` helpers | 2 services | advisory-ctrl, execution-ctrl |
| `NamedPipe` interface, `eventPipeMap` | 2 services | dashboard-bff, ledger-bff |
| `StartExecutionCommand` / SFN client | 1 service | decision-workflow-ctrl |
| Manual `reducer.ts` handler | 1 file | ledger-ctrl |

### Kept

- **Repository classes** — still used by GraphQL resolvers (BFF query/mutation handlers), just no longer imported by event-listeners
- **`createHandlers(deps)` pattern** — only for 5 `resumeStateMachine` services (agent/workflow handlers with real deps)
- **`transactWrite` calls unrelated to EditEvents** — any transactional write that serves a business purpose (not audit) stays. Each surviving call must be reviewed during implementation.

---

## Testing Strategy

### Pure intent handlers (Pattern A)

No mocks needed. Test input → assert returned intent:

```ts
it('should return record intent for USER_REGISTERED', () => {
  const uow = fakeUow({ subject: { userId: 'u1', tenantId: 't1', email: 'a@b.c' } });
  const intent = userRegistered(uow);
  expect(intent).toEqual(record('InvestorProfile', { tenantId: 't1', userId: 'u1', email: 'a@b.c' }));
});
```

### SFN callback handlers (Pattern B)

Mock agent service + memory client, assert `{ output, intents }`:

```ts
it('should return output and AgentInvocation record', async () => {
  const deps = { agentService: mockAgentService, memoryClient: mockMemoryClient };
  const handlers = createHandlers(deps);
  const result = await handlers.ANALYZE_INVESTOR_PROFILE(payload, ctx);
  expect(result.output).toEqual({ decisionId: 'd1', tenantId: 't1' });
  expect(result.intents).toEqual([record('AgentInvocation', expect.objectContaining({ agentName: 'investor-profile' }))]);
});
```

### Integration tests

Use existing `createTestHarness` / `createStreamTestHarness` from event-processor to test the full pipeline (SQS record → handler → intent execution → DDB assertions).

### Reducer tests

Use existing `createReducerTestHarness` to test `replayAndReduce` with the `accountReducer`.

---

## Scope Summary

| Category | Items |
|---|---|
| New intents | `update()` (new), `store()` (rename + implement) |
| New pipelines | `resumeStateMachine` |
| File moves | `createEventHandler`, `createStreamHandler` → `engine/` |
| New exports | `toUow` from event-processor |
| Services migrated | 16 event-listeners |
| Pipe files deleted | 14 |
| EditEvent removal | 4 repositories cleaned |
| CDK changes | 1 EventBridge rule (decision-workflow-ctrl), 1 new Lambda (ledger-ctrl reducer) |
| New tests | ~16 transform function tests (replacing ~14 pipe tests), intent executor tests for `update` + `store`, `resumeStateMachine` pipeline tests |
