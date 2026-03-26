# Real Money Operations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable real money trading via Alpaca while preserving the simulation engine and broker-agnostic architecture.

**Architecture:** Anti-Corruption Layer with `broker-ctrl` (AWS-native SF Standard Workflow, 2 Lambdas) routing orders per-tenant to `broker-sim-adpt` (simulation) or `broker-alpaca-adpt` (Alpaca Trading API). Normalization via CDC. TaxLotManager in ledger-ctrl for FIFO cost-basis tracking. Go Live re-onboarding flow.

**Tech Stack:** TypeScript, AWS CDK, Step Functions (Standard Workflow with direct service integrations), DynamoDB, EventBridge, Lambda, event-processor pipelines, Jest, Angular (MFE)

**Spec:** `docs/superpowers/specs/2026-03-26-real-money-ops-design.md`
**SF Native Design:** `docs/superpowers/specs/2026-03-26-broker-ctrl-sf-native-design.md`

**Key conventions:**
- All Lambda handlers use event-processor pipelines (`materializeToTable`, `changeDataCapture`, `buildEventTypeMap`)
- Tests in `test/` directory (NOT `src/__tests__/`)
- DDB items require `__typename` field for CDC filtering
- Repositories extend `TableRepository` from `@nestfolio/event-processor`
- Services extend `ServiceStack` from `@nestfolio/cdk-constructs`
- `stateProps: false` for stateless adapters
- All inter-service communication via EventBridge (no API calls between services)

---

## Phase 1: broker-sim-adpt (rename from broker-adpt)

Lowest risk. Rename the service, update event types. No new functionality — just event name changes so broker-ctrl can route to it later.

### Task 1.1: Rename service directory and update Nx config

**Files:**
- Rename: `services/execution/broker-adpt/` → `services/execution/broker-sim-adpt/`
- Modify: `services/execution/broker-sim-adpt/project.json`
- Modify: `services/execution/broker-sim-adpt/src/service.stack.ts`
- Modify: `services/execution/broker-sim-adpt/src/main.ts`
- Modify: `tsconfig.base.json` (if path aliases reference broker-adpt)

- [ ] **Step 1: Rename the directory**

```bash
mv services/execution/broker-adpt services/execution/broker-sim-adpt
```

- [ ] **Step 2: Update project.json name and paths**

In `services/execution/broker-sim-adpt/project.json`:
- Change `"name": "broker-adpt"` → `"name": "broker-sim-adpt"`
- Update all `services/execution/broker-adpt` references to `services/execution/broker-sim-adpt`
- Update tags: `"type:adpt"` stays, add `"scope:execution"`

- [ ] **Step 3: Update service.stack.ts class name and service identifier**

In `services/execution/broker-sim-adpt/src/service.stack.ts`:
- Rename class `BrokerAdptStack` → `BrokerSimAdptStack`
- Update `service: 'broker-sim-adpt'` in props

- [ ] **Step 4: Update main.ts**

In `services/execution/broker-sim-adpt/src/main.ts`:
- Update stack class import and instantiation

- [ ] **Step 5: Search and fix all cross-references**

Search for `broker-adpt` across the entire codebase:
- `execution-adpt` may reference event types from broker-adpt's domain
- `tsconfig.base.json` path aliases
- Any import paths

```bash
pnpm nx run broker-sim-adpt:lint
```

- [ ] **Step 6: Run existing tests to confirm rename didn't break anything**

```bash
pnpm nx run broker-sim-adpt:test
```

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "refactor: rename broker-adpt to broker-sim-adpt"
```

### Task 1.2: Define new sim-specific event types

**Files:**
- Modify: `services/execution/broker-sim-adpt/src/domain/events.ts`
- Modify: `services/execution/broker-sim-adpt/src/domain/schemas.ts`

- [ ] **Step 1: Add sim-specific event type constants**

In `services/execution/broker-sim-adpt/src/domain/events.ts`, add:
```typescript
export const BrokerSimEventTypes = {
  // Inbound (from broker-ctrl)
  SIM_ORDER_REQUESTED: 'SIM_ORDER_REQUESTED',
  SIM_DEPOSIT_INITIATED: 'SIM_DEPOSIT_INITIATED',
  SIM_WITHDRAWAL_REQUESTED: 'SIM_WITHDRAWAL_REQUESTED',

  // Outbound (CDC)
  SIM_ORDER_FILLED: 'SIM_ORDER_FILLED',
  SIM_ORDER_REJECTED: 'SIM_ORDER_REJECTED',
  SIM_DEPOSIT_COMPLETED: 'SIM_DEPOSIT_COMPLETED',
  SIM_WITHDRAWAL_COMPLETED: 'SIM_WITHDRAWAL_COMPLETED',
} as const;
```

- [ ] **Step 2: Add Zod schemas for new event types**

In `services/execution/broker-sim-adpt/src/domain/schemas.ts`:
- Create `SimOrderRequestedSchema` matching the existing order payload shape
- Create `SimDepositInitiatedSchema`, `SimWithdrawalRequestedSchema`

- [ ] **Step 3: Commit**

```bash
git add services/execution/broker-sim-adpt/src/domain/ && git commit -m "feat(broker-sim-adpt): define sim-specific event types and schemas"
```

### Task 1.3: Update Ingress to listen for sim-specific events

**Files:**
- Modify: `services/execution/broker-sim-adpt/src/service.stack.ts`
- Modify: `services/execution/broker-sim-adpt/src/handlers/event-listener.ts`
- Modify: `services/execution/broker-sim-adpt/test/event-listener.test.ts`

- [ ] **Step 1: Write failing test — event-listener handles SIM_ORDER_REQUESTED**

In `services/execution/broker-sim-adpt/test/event-listener.test.ts`:
- Add test case for `SIM_ORDER_REQUESTED` event type
- Expect SimulationEngineService to be called with order payload
- Expect DDB write with filled order record

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm nx run broker-sim-adpt:test -- --testPathPattern=event-listener
```

- [ ] **Step 3: Update event-listener.ts handler map**

Replace `ORDER_SUBMITTED` handler with `SIM_ORDER_REQUESTED` handler.
Replace `DEPOSIT_INITIATED` with `SIM_DEPOSIT_INITIATED`.
Replace `WITHDRAWAL_REQUESTED` with `SIM_WITHDRAWAL_REQUESTED`.

Use `materializeToTable` pipeline with the new event type keys:
```typescript
export const handler = materializeToTable({
  handlers: {
    [BrokerSimEventTypes.SIM_ORDER_REQUESTED]: processSimOrder,
    [BrokerSimEventTypes.SIM_DEPOSIT_INITIATED]: processSimDeposit,
    [BrokerSimEventTypes.SIM_WITHDRAWAL_REQUESTED]: processSimWithdrawal,
  },
});
```

- [ ] **Step 4: Update Ingress eventTypes in service.stack.ts**

```typescript
const ingress = new Ingress(this, 'Ingress', {
  eventTypes: [
    BrokerSimEventTypes.SIM_ORDER_REQUESTED,
    BrokerSimEventTypes.SIM_DEPOSIT_INITIATED,
    BrokerSimEventTypes.SIM_WITHDRAWAL_REQUESTED,
  ],
});
```

- [ ] **Step 5: Run tests to verify all pass**

```bash
pnpm nx run broker-sim-adpt:test
```

- [ ] **Step 6: Commit**

```bash
git add services/execution/broker-sim-adpt/ && git commit -m "feat(broker-sim-adpt): update ingress to sim-specific event types"
```

### Task 1.4: Update Egress CDC to emit sim-specific events

**Files:**
- Modify: `services/execution/broker-sim-adpt/src/handlers/event-publisher.ts`
- Modify: `services/execution/broker-sim-adpt/test/event-publisher.test.ts`

- [ ] **Step 1: Write failing test — CDC emits SIM_ORDER_FILLED**

In `services/execution/broker-sim-adpt/test/event-publisher.test.ts`:
- Add test: VirtualTrade INSERT with status=FILLED → emits `SIM_ORDER_FILLED`
- Add test: VirtualTrade INSERT with status=REJECTED → emits `SIM_ORDER_REJECTED`

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm nx run broker-sim-adpt:test -- --testPathPattern=event-publisher
```

- [ ] **Step 3: Update event-publisher.ts customEventTypeMap**

Replace `buildEventTypeMap` convention with explicit `customEventTypeMap`:
```typescript
export const handler = changeDataCapture({
  serviceName: 'broker-sim-adpt',
  eventTypeMap: {
    'VirtualTrade:INSERT': (record) =>
      record.dynamodb?.NewImage?.status?.S === 'REJECTED'
        ? BrokerSimEventTypes.SIM_ORDER_REJECTED
        : BrokerSimEventTypes.SIM_ORDER_FILLED,
    'VirtualTrade:MODIFY': (record) =>
      record.dynamodb?.NewImage?.status?.S === 'REJECTED'
        ? BrokerSimEventTypes.SIM_ORDER_REJECTED
        : BrokerSimEventTypes.SIM_ORDER_FILLED,
    'DepositDetected:INSERT': BrokerSimEventTypes.SIM_DEPOSIT_COMPLETED,
    'WithdrawalCompleted:INSERT': BrokerSimEventTypes.SIM_WITHDRAWAL_COMPLETED,
  },
});
```

- [ ] **Step 4: Run tests to verify all pass**

```bash
pnpm nx run broker-sim-adpt:test
```

- [ ] **Step 5: Commit**

```bash
git add services/execution/broker-sim-adpt/ && git commit -m "feat(broker-sim-adpt): update CDC to emit sim-specific events"
```

---

## Phase 2: broker-ctrl (new service — SF state machine)

The orchestration hub. SF Standard Workflow with direct service integrations, 2 Lambdas (RouteOrder + CallbackResolver).

### Task 2.1: Scaffold broker-ctrl service

**Files:**
- Create: `services/execution/broker-ctrl/project.json`
- Create: `services/execution/broker-ctrl/jest.config.js`
- Create: `services/execution/broker-ctrl/tsconfig.json`
- Create: `services/execution/broker-ctrl/tsconfig.lib.json`
- Create: `services/execution/broker-ctrl/tsconfig.spec.json`
- Create: `services/execution/broker-ctrl/src/main.ts`
- Create: `services/execution/broker-ctrl/src/service.stack.ts`
- Create: `services/execution/broker-ctrl/src/domain/events.ts`
- Create: `services/execution/broker-ctrl/src/domain/schemas.ts`
- Create: `services/execution/broker-ctrl/src/domain/index.ts`

- [ ] **Step 1: Create project directory structure**

```bash
mkdir -p services/execution/broker-ctrl/src/{domain,handlers,repositories}
mkdir -p services/execution/broker-ctrl/test
```

- [ ] **Step 2: Create project.json**

Copy from `services/execution/broker-sim-adpt/project.json`, update:
- `"name": "broker-ctrl"`
- All paths to `services/execution/broker-ctrl`
- Tags: `["scope:execution", "type:ctrl"]`

- [ ] **Step 3: Create jest.config.js, tsconfig files**

Copy from broker-sim-adpt, update paths.

- [ ] **Step 4: Create domain/events.ts**

```typescript
export const BrokerCtrlEventTypes = {
  // Normalized outbound (CDC)
  ORDER_FILLED: 'ORDER_FILLED',
  ORDER_PARTIALLY_FILLED: 'ORDER_PARTIALLY_FILLED',
  ORDER_REJECTED: 'ORDER_REJECTED',
  ORDER_CANCELLED: 'ORDER_CANCELLED',
  ORDER_ESCALATED: 'ORDER_ESCALATED',
  DEPOSIT_DETECTED: 'DEPOSIT_DETECTED',
  WITHDRAWAL_COMPLETED: 'WITHDRAWAL_COMPLETED',
  BROKER_CIRCUIT_OPEN: 'BROKER_CIRCUIT_OPEN',
} as const;

// Events this service routes (emits to ExecutionBus for adapters)
export const BrokerCtrlRoutedEventTypes = {
  SIM_ORDER_REQUESTED: 'SIM_ORDER_REQUESTED',
  SIM_DEPOSIT_INITIATED: 'SIM_DEPOSIT_INITIATED',
  SIM_WITHDRAWAL_REQUESTED: 'SIM_WITHDRAWAL_REQUESTED',
  ALPACA_ORDER_REQUESTED: 'ALPACA_ORDER_REQUESTED',
  ALPACA_ORDER_CANCEL_REQUESTED: 'ALPACA_ORDER_CANCEL_REQUESTED',
  ALPACA_TRANSFER_REQUESTED: 'ALPACA_TRANSFER_REQUESTED',
  ALPACA_ACCOUNT_CHECK: 'ALPACA_ACCOUNT_CHECK',
} as const;

// Events this service subscribes to (adapter results)
export const BrokerCtrlInboundEventTypes = {
  ORDER_SUBMITTED: 'ORDER_SUBMITTED',       // from execution-ctrl (triggers SF)
  EXECUTION_MODE_CHANGED: 'EXECUTION_MODE_CHANGED', // from investor-bff
  // Adapter results handled by CallbackResolver
  SIM_ORDER_FILLED: 'SIM_ORDER_FILLED',
  SIM_ORDER_REJECTED: 'SIM_ORDER_REJECTED',
  SIM_DEPOSIT_COMPLETED: 'SIM_DEPOSIT_COMPLETED',
  SIM_WITHDRAWAL_COMPLETED: 'SIM_WITHDRAWAL_COMPLETED',
  ALPACA_ORDER_PLACED: 'ALPACA_ORDER_PLACED',
  ALPACA_ORDER_FILLED: 'ALPACA_ORDER_FILLED',
  ALPACA_ORDER_PARTIALLY_FILLED: 'ALPACA_ORDER_PARTIALLY_FILLED',
  ALPACA_ORDER_REJECTED: 'ALPACA_ORDER_REJECTED',
  ALPACA_ORDER_CANCELLED: 'ALPACA_ORDER_CANCELLED',
  ALPACA_ORDER_CANCEL_FAILED: 'ALPACA_ORDER_CANCEL_FAILED',
  ALPACA_TRANSFER_COMPLETED: 'ALPACA_TRANSFER_COMPLETED',
  ALPACA_TRANSFER_FAILED: 'ALPACA_TRANSFER_FAILED',
  ALPACA_ACCOUNT_SNAPSHOT: 'ALPACA_ACCOUNT_SNAPSHOT',
} as const;
```

- [ ] **Step 5: Create domain/schemas.ts with Zod schemas**

Define schemas for BrokerOrder, NormalizedEvent, CircuitBreaker, ExecutionMode entities.

- [ ] **Step 6: Create minimal service.stack.ts**

```typescript
export class BrokerCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });
    // State: DDB table (BrokerOrder, NormalizedEvent, CircuitBreaker, ExecutionMode)
    // Egress: CDC for NormalizedEvent → canonical events
    // SF + Lambdas added in subsequent tasks
  }
}
```

- [ ] **Step 7: Create main.ts CDK app entrypoint**

Follow pattern from broker-sim-adpt/src/main.ts.

- [ ] **Step 8: Verify scaffolding compiles**

```bash
pnpm nx run broker-ctrl:lint
```

- [ ] **Step 9: Commit**

```bash
git add services/execution/broker-ctrl/ && git commit -m "feat(broker-ctrl): scaffold new service with domain types"
```

### Task 2.2: Implement BrokerOrder repository

**Files:**
- Create: `services/execution/broker-ctrl/src/repositories/broker-order.repository.ts`
- Create: `services/execution/broker-ctrl/test/broker-order.repository.test.ts`

- [ ] **Step 1: Write failing tests for BrokerOrder CRUD**

Test cases:
- `createOrder` — writes BrokerOrder with state=ROUTING
- `updateOrderState` — transitions state + updates fields
- `getOrder` — reads by tenantId + orderId
- `storeTaskToken` — stores fillTaskToken on existing record
- `getTaskToken` — reads fillTaskToken by orderId

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm nx run broker-ctrl:test -- --testPathPattern=broker-order
```

- [ ] **Step 3: Implement BrokerOrderRepository**

Extend `TableRepository` from `@nestfolio/event-processor`:
```typescript
export class BrokerOrderRepository extends TableRepository {
  private readonly log = withMethodLogging('BrokerOrderRepository');

  readonly createOrder = this.log('createOrder',
    async (params: CreateOrderParams): Promise<WriteIntent> => {
      return {
        pk: `BrokerOrder#${params.tenantId}#${params.orderId}`,
        sk: 'BrokerOrder',
        __typename: 'BrokerOrder',
        state: 'ROUTING',
        ...params,
      };
    },
  );

  readonly storeTaskToken = this.log('storeTaskToken',
    async (tenantId: string, orderId: string, taskToken: string): Promise<void> => {
      await this.update({
        pk: `BrokerOrder#${tenantId}#${orderId}`,
        sk: 'BrokerOrder',
        updates: { fillTaskToken: taskToken },
      });
    },
  );

  readonly getTaskToken = this.log('getTaskToken',
    async (tenantId: string, orderId: string): Promise<string | null> => {
      const item = await this.get({
        pk: `BrokerOrder#${tenantId}#${orderId}`,
        sk: 'BrokerOrder',
      });
      return item?.fillTaskToken ?? null;
    },
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm nx run broker-ctrl:test -- --testPathPattern=broker-order
```

- [ ] **Step 5: Commit**

```bash
git add services/execution/broker-ctrl/ && git commit -m "feat(broker-ctrl): implement BrokerOrder repository"
```

### Task 2.3: Implement ExecutionMode and CircuitBreaker repositories

**Files:**
- Create: `services/execution/broker-ctrl/src/repositories/execution-mode.repository.ts`
- Create: `services/execution/broker-ctrl/src/repositories/circuit-breaker.repository.ts`
- Create: `services/execution/broker-ctrl/test/execution-mode.repository.test.ts`
- Create: `services/execution/broker-ctrl/test/circuit-breaker.repository.test.ts`

- [ ] **Step 1: Write failing tests for ExecutionMode cache**

Test cases:
- `upsertMode` — writes/updates ExecutionMode#{tenantId}
- `getMode` — returns `'simulation'` or `'live'`, defaults to `'simulation'`

- [ ] **Step 2: Implement ExecutionModeRepository**

- [ ] **Step 3: Write failing tests for CircuitBreaker**

Test cases:
- `getBreaker` — reads by tenantId + symbol (or Global)
- `openBreaker` — sets state=OPEN
- `closeBreaker` — sets state=CLOSED
- `isOpen` — returns boolean

- [ ] **Step 4: Implement CircuitBreakerRepository**

- [ ] **Step 5: Run all tests**

```bash
pnpm nx run broker-ctrl:test
```

- [ ] **Step 6: Commit**

```bash
git add services/execution/broker-ctrl/ && git commit -m "feat(broker-ctrl): implement ExecutionMode and CircuitBreaker repositories"
```

### Task 2.4: Implement ExecutionMode cache handler (Ingress)

**Files:**
- Create: `services/execution/broker-ctrl/src/handlers/mode-listener.ts`
- Create: `services/execution/broker-ctrl/test/mode-listener.test.ts`

This handler subscribes to `EXECUTION_MODE_CHANGED` and caches the mode locally.

- [ ] **Step 1: Write failing test**

Test: receives `EXECUTION_MODE_CHANGED` event → writes to DDB via `ExecutionModeRepository.upsertMode`

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm nx run broker-ctrl:test -- --testPathPattern=mode-listener
```

- [ ] **Step 3: Implement handler**

```typescript
export const handler = materializeToTable({
  handlers: {
    [BrokerCtrlInboundEventTypes.EXECUTION_MODE_CHANGED]: (payload, ctx) => ({
      pk: `ExecutionMode#${ctx.tenantId}`,
      sk: 'ExecutionMode',
      __typename: 'ExecutionMode',
      tenantId: ctx.tenantId,
      mode: payload.mode,
      updatedAt: ctx.timestamp,
    }),
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add services/execution/broker-ctrl/ && git commit -m "feat(broker-ctrl): implement execution mode cache handler"
```

### Task 2.5: Implement RouteOrder Lambda

**Files:**
- Create: `services/execution/broker-ctrl/src/handlers/route-order.ts`
- Create: `services/execution/broker-ctrl/test/route-order.test.ts`

This Lambda is invoked by the SF with a taskToken. It stores the taskToken in DDB and emits the routed event to EventBridge.

- [ ] **Step 1: Write failing tests**

Test cases:
- Receives order + executionMode='simulation' + taskToken → writes BrokerOrder with taskToken → emits SIM_ORDER_REQUESTED
- Receives order + executionMode='live' + taskToken → writes BrokerOrder with taskToken → emits ALPACA_ORDER_REQUESTED
- EventBridge PutEvents called with correct bus, detailType, and payload

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm nx run broker-ctrl:test -- --testPathPattern=route-order
```

- [ ] **Step 3: Implement RouteOrder Lambda**

```typescript
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

export async function handler(event: {
  order: OrderPayload;
  executionMode: string;
  taskToken: string;
}) {
  const { order, executionMode, taskToken } = event;
  const repo = new BrokerOrderRepository(process.env.TABLE_NAME!);

  // Write BrokerOrder with taskToken
  await repo.createOrder({
    tenantId: order.tenantId,
    orderId: order.orderId,
    executionMode,
    state: 'AWAITING_FILL',
    routedTo: executionMode === 'live' ? 'alpaca' : 'sim',
    fillTaskToken: taskToken,
    requestedQty: order.quantity,
    filledQty: 0,
    remainingQty: order.quantity,
    retryCount: 0,
    instrumentId: order.symbol,
    routedAt: new Date().toISOString(),
  });

  // Emit routed event
  const detailType = executionMode === 'live'
    ? BrokerCtrlRoutedEventTypes.ALPACA_ORDER_REQUESTED
    : BrokerCtrlRoutedEventTypes.SIM_ORDER_REQUESTED;

  const eb = new EventBridgeClient({});
  await eb.send(new PutEventsCommand({
    Entries: [{
      EventBusName: process.env.BUS_NAME,
      Source: 'broker-ctrl',
      DetailType: detailType,
      Detail: JSON.stringify(order),
    }],
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add services/execution/broker-ctrl/ && git commit -m "feat(broker-ctrl): implement RouteOrder Lambda"
```

### Task 2.6: Implement CallbackResolver Lambda

**Files:**
- Create: `services/execution/broker-ctrl/src/handlers/callback-resolver.ts`
- Create: `services/execution/broker-ctrl/test/callback-resolver.test.ts`

This Lambda receives adapter result events, looks up the taskToken from DDB, classifies the failure, and calls SendTaskSuccess to resume the SF.

- [ ] **Step 1: Write failing tests**

Test cases:
- SIM_ORDER_FILLED → looks up taskToken → SendTaskSuccess with `{ status: 'FILLED', ... }`
- ALPACA_ORDER_REJECTED (insufficient funds) → SendTaskSuccess with `{ status: 'REJECTED', failureClass: 'deterministic', ... }`
- ALPACA_ORDER_REJECTED (5xx error) → SendTaskSuccess with `{ status: 'REJECTED', failureClass: 'transient', ... }`
- ALPACA_ORDER_PARTIALLY_FILLED → SendTaskSuccess with `{ status: 'PARTIALLY_FILLED', ... }`
- No taskToken found → logs warning, returns (idempotent)

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm nx run broker-ctrl:test -- --testPathPattern=callback-resolver
```

- [ ] **Step 3: Implement failure classification logic**

```typescript
function classifyFailure(eventType: string, payload: Record<string, unknown>): FailureClass {
  if (['SIM_ORDER_FILLED', 'ALPACA_ORDER_FILLED'].includes(eventType)) return 'none';
  if (['SIM_ORDER_REJECTED', 'ALPACA_ORDER_REJECTED'].includes(eventType)) {
    const reason = payload.rejectionReason as string ?? '';
    if (/insufficient|buying power/i.test(reason)) return 'deterministic';
    if (/halted|delisted|invalid/i.test(reason)) return 'deterministic';
    if (/timeout|5\d{2}|rate.limit|unavailable/i.test(reason)) return 'transient';
    return 'deterministic'; // default: don't retry unknown rejections
  }
  return 'ambiguous';
}
```

- [ ] **Step 4: Implement CallbackResolver handler**

Use `materializeToTable` pipeline pattern. On each adapter result event:
1. Extract orderId from payload
2. Read taskToken from BrokerOrderRepository
3. Classify failure
4. Call SFN SendTaskSuccess with classified result

- [ ] **Step 5: Run tests to verify they pass**

- [ ] **Step 6: Commit**

```bash
git add services/execution/broker-ctrl/ && git commit -m "feat(broker-ctrl): implement CallbackResolver Lambda with failure classification"
```

### Task 2.7: Implement CDC event-publisher for normalized events

**Files:**
- Create: `services/execution/broker-ctrl/src/handlers/event-publisher.ts`
- Create: `services/execution/broker-ctrl/test/event-publisher.test.ts`

CDC pipeline that emits canonical events when NormalizedEvent records are written by the SF.

- [ ] **Step 1: Write failing tests**

Test cases:
- NormalizedEvent INSERT with sk=ORDER_FILLED → emits `ORDER_FILLED` to ExecutionBus
- NormalizedEvent INSERT with sk=ORDER_REJECTED → emits `ORDER_REJECTED`
- NormalizedEvent INSERT with sk=ORDER_ESCALATED → emits `ORDER_ESCALATED`
- NormalizedEvent INSERT with sk=BROKER_CIRCUIT_OPEN → emits `BROKER_CIRCUIT_OPEN`
- BrokerOrder MODIFY → no event (not a publishable type)

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement event-publisher**

```typescript
export const handler = changeDataCapture({
  serviceName: 'broker-ctrl',
  eventTypeMap: {
    'NormalizedEvent:INSERT': (record) => {
      const sk = record.dynamodb?.NewImage?.sk?.S ?? '';
      return sk; // sk IS the event type (ORDER_FILLED, ORDER_REJECTED, etc.)
    },
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add services/execution/broker-ctrl/ && git commit -m "feat(broker-ctrl): implement CDC event-publisher for normalized events"
```

### Task 2.8: Define Step Functions state machine in CDK

**Files:**
- Create: `services/execution/broker-ctrl/src/state-machine/order-state-machine.ts`
- Modify: `services/execution/broker-ctrl/src/service.stack.ts`

Reference: `services/advisory/decision-workflow-ctrl/src/` for the existing SF pattern with `waitForTaskToken`.

- [ ] **Step 1: Read decision-workflow-ctrl SF pattern for reference**

Read `services/advisory/decision-workflow-ctrl/src/service.stack.ts` and any `*state-machine*.ts` files to understand how SF is defined in CDK in this codebase.

- [ ] **Step 2: Create order-state-machine.ts**

Define the SF Standard Workflow using CDK `sfn.CustomState` for direct integrations:

States:
1. `ReadExecutionMode` — DynamoDB GetItem (direct)
2. `ReadCircuitBreaker` — DynamoDB GetItem (direct)
3. `IsCircuitBreakerOpen` — Choice
4. `BreakerWait` — Wait 30s → loop to ReadCircuitBreaker
5. `RouteOrder` — Lambda invoke with `.waitForTaskToken` (RouteOrder Lambda)
6. `ClassifyResult` — Choice on `$.adapterResult.status` and `$.adapterResult.failureClass`
7. `MarkFilled` — Parallel: DynamoDB UpdateItem (BrokerOrder) + PutItem (NormalizedEvent ORDER_FILLED)
8. `MarkPartialFill` — DynamoDB UpdateItem → WaitForMoreFills (WaitForTaskCallback 15min) → loop
9. `MarkRejected` — Parallel: DynamoDB UpdateItem + PutItem (NormalizedEvent ORDER_REJECTED)
10. `CheckRetryCount` — Choice
11. `IncrementRetry` — DynamoDB UpdateItem
12. `RetryWait` — Wait (5s/15s/45s based on retryCount)
13. `ReEmitEvent` — EventBridge PutEvents (direct)
14. `WaitForRetryResult` — WaitForTaskCallback
15. `MarkFailed` — Parallel: DynamoDB UpdateItem + PutItem (NormalizedEvent ORDER_REJECTED)
16. `HandleTimeout` — Parallel: DynamoDB UpdateItem (open breaker + ESCALATED) + PutItem (NormalizedEvent ORDER_ESCALATED)

Use `sfn.CustomState` with JSON state definitions for direct integrations, following the pattern in `docs/superpowers/specs/2026-03-26-broker-ctrl-sf-native-design.md`.

- [ ] **Step 3: Commit state machine definition**

```bash
git add services/execution/broker-ctrl/src/state-machine/ && git commit -m "feat(broker-ctrl): define order state machine in CDK"
```

### Task 2.9: Wire up service.stack.ts with all constructs

**Files:**
- Modify: `services/execution/broker-ctrl/src/service.stack.ts`

- [ ] **Step 1: Configure State (DDB table)**

Default ServiceStack creates the table. Entities: BrokerOrder, NormalizedEvent, CircuitBreaker, ExecutionMode.

- [ ] **Step 2: Configure Egress (CDC for NormalizedEvent)**

```typescript
const egress = new Egress(this, 'Egress', {
  publishableTypes: ['NormalizedEvent'],
});
```

- [ ] **Step 3: Configure Ingress for ExecutionMode cache**

```typescript
const modeIngress = new Ingress(this, 'ModeIngress', {
  eventTypes: [BrokerCtrlInboundEventTypes.EXECUTION_MODE_CHANGED],
  entry: join(__dirname, 'handlers', 'mode-listener.ts'),
});
```

- [ ] **Step 4: Configure Ingress for CallbackResolver**

```typescript
const callbackIngress = new Ingress(this, 'CallbackIngress', {
  eventTypes: [
    ...Object.values(BrokerSimEventTypes).filter(e => e.startsWith('SIM_ORDER') || e.startsWith('SIM_DEPOSIT') || e.startsWith('SIM_WITHDRAWAL')),
    'ALPACA_ORDER_PLACED', 'ALPACA_ORDER_FILLED', 'ALPACA_ORDER_PARTIALLY_FILLED',
    'ALPACA_ORDER_REJECTED', 'ALPACA_ORDER_CANCELLED', 'ALPACA_ORDER_CANCEL_FAILED',
    'ALPACA_TRANSFER_COMPLETED', 'ALPACA_TRANSFER_FAILED',
  ],
  entry: join(__dirname, 'handlers', 'callback-resolver.ts'),
});
```

- [ ] **Step 5: Configure Step Functions**

Create the SF Standard Workflow from task 2.8. Grant permissions:
- SF → DDB table (read/write)
- SF → EventBridge (PutEvents)
- SF → RouteOrder Lambda (invoke)
- CallbackResolver Lambda → SF (SendTaskSuccess)

- [ ] **Step 6: Configure EventBridge rule to trigger SF**

```typescript
new Rule(this, 'OrderSubmittedTrigger', {
  eventBus: executionBus,
  eventPattern: { detailType: ['ORDER_SUBMITTED'] },
  targets: [new SfnStateMachine(stateMachine, {
    input: RuleTargetInput.fromEventPath('$.detail'),
  })],
});
```

- [ ] **Step 7: Commit**

```bash
git add services/execution/broker-ctrl/ && git commit -m "feat(broker-ctrl): wire up service stack with SF, Ingress, Egress"
```

### Task 2.10: Integration tests for broker-ctrl

**Files:**
- Create: `services/execution/broker-ctrl/test/integration/order-lifecycle.test.ts`

- [ ] **Step 1: Write integration tests for the full order lifecycle**

Test cases (with mocked DDB and EventBridge):
- ORDER_SUBMITTED → SF starts → RouteOrder writes BrokerOrder + emits SIM_ORDER_REQUESTED → SIM_ORDER_FILLED callback → NormalizedEvent ORDER_FILLED written
- ORDER_SUBMITTED → transient failure → retry → eventual fill
- ORDER_SUBMITTED → deterministic rejection → ORDER_REJECTED normalized
- ORDER_SUBMITTED → timeout → circuit breaker opened → ORDER_ESCALATED

- [ ] **Step 2: Run tests**

```bash
pnpm nx run broker-ctrl:test
```

- [ ] **Step 3: Commit**

```bash
git add services/execution/broker-ctrl/test/ && git commit -m "test(broker-ctrl): add order lifecycle integration tests"
```

---

## Phase 3: broker-alpaca-adpt (new service)

Thin Alpaca Trading API wrapper + polling.

### Task 3.1: Scaffold broker-alpaca-adpt service

**Files:**
- Create: `services/execution/broker-alpaca-adpt/` (full service scaffold)

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p services/execution/broker-alpaca-adpt/src/{domain,handlers,services,clients,repositories}
mkdir -p services/execution/broker-alpaca-adpt/test
```

- [ ] **Step 2: Create project.json, jest.config.js, tsconfig files**

Copy from broker-sim-adpt, update name to `broker-alpaca-adpt`, tags: `["scope:execution", "type:adpt"]`.

- [ ] **Step 3: Create domain/events.ts**

```typescript
export const AlpacaAdptEventTypes = {
  // Inbound (from broker-ctrl)
  ALPACA_ORDER_REQUESTED: 'ALPACA_ORDER_REQUESTED',
  ALPACA_ORDER_CANCEL_REQUESTED: 'ALPACA_ORDER_CANCEL_REQUESTED',
  ALPACA_TRANSFER_REQUESTED: 'ALPACA_TRANSFER_REQUESTED',
  ALPACA_ACCOUNT_CHECK: 'ALPACA_ACCOUNT_CHECK',

  // Outbound (CDC)
  ALPACA_ORDER_PLACED: 'ALPACA_ORDER_PLACED',
  ALPACA_ORDER_FILLED: 'ALPACA_ORDER_FILLED',
  ALPACA_ORDER_PARTIALLY_FILLED: 'ALPACA_ORDER_PARTIALLY_FILLED',
  ALPACA_ORDER_REJECTED: 'ALPACA_ORDER_REJECTED',
  ALPACA_ORDER_CANCELLED: 'ALPACA_ORDER_CANCELLED',
  ALPACA_ORDER_CANCEL_FAILED: 'ALPACA_ORDER_CANCEL_FAILED',
  ALPACA_TRANSFER_INITIATED: 'ALPACA_TRANSFER_INITIATED',
  ALPACA_TRANSFER_COMPLETED: 'ALPACA_TRANSFER_COMPLETED',
  ALPACA_TRANSFER_FAILED: 'ALPACA_TRANSFER_FAILED',
  ALPACA_ACCOUNT_SNAPSHOT: 'ALPACA_ACCOUNT_SNAPSHOT',
} as const;
```

- [ ] **Step 4: Create minimal service.stack.ts and main.ts**

- [ ] **Step 5: Verify scaffolding compiles**

```bash
pnpm nx run broker-alpaca-adpt:lint
```

- [ ] **Step 6: Commit**

```bash
git add services/execution/broker-alpaca-adpt/ && git commit -m "feat(broker-alpaca-adpt): scaffold new service"
```

### Task 3.2: Implement Alpaca HTTP client

**Files:**
- Create: `services/execution/broker-alpaca-adpt/src/clients/alpaca.client.ts`
- Create: `services/execution/broker-alpaca-adpt/test/alpaca.client.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:
- `submitOrder` — calls POST /v2/orders with correct headers and body
- `cancelOrder` — calls DELETE /v2/orders/{id}
- `getTradeEvents` — calls GET /v2/events/trades?since=X&until=Y
- `getAccount` — calls GET /v2/account
- `getPositions` — calls GET /v2/positions
- `initiateTransfer` — calls POST /v2/ach/transfers
- `getTransfer` — calls GET /v2/ach/transfers/{id}
- Auth headers: `APCA-API-KEY-ID` and `APCA-API-SECRET-KEY` from env vars
- Error handling: returns raw error for broker-ctrl to classify

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement AlpacaClient**

```typescript
export class AlpacaClient {
  private readonly baseUrl: string;
  private readonly apiKeyId: string;
  private readonly apiKeySecret: string;

  constructor() {
    this.baseUrl = process.env.ALPACA_BASE_URL!;
    this.apiKeyId = process.env.ALPACA_API_KEY_ID!;
    this.apiKeySecret = process.env.ALPACA_API_KEY_SECRET!;
  }

  private async request(method: string, path: string, body?: unknown) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'APCA-API-KEY-ID': this.apiKeyId,
        'APCA-API-SECRET-KEY': this.apiKeySecret,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, data: await response.json() };
  }

  async submitOrder(params: AlpacaOrderParams) { /* POST /v2/orders */ }
  async cancelOrder(alpacaOrderId: string) { /* DELETE /v2/orders/{id} */ }
  async getTradeEvents(since: string, until: string) { /* GET /v2/events/trades */ }
  async getAccount() { /* GET /v2/account */ }
  async getPositions() { /* GET /v2/positions */ }
  async initiateTransfer(params: AlpacaTransferParams) { /* POST /v2/ach/transfers */ }
  async getTransfer(transferId: string) { /* GET /v2/ach/transfers/{id} */ }
}
```

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add services/execution/broker-alpaca-adpt/ && git commit -m "feat(broker-alpaca-adpt): implement Alpaca HTTP client"
```

### Task 3.3: Implement OrderMapping and PollingState repositories

**Files:**
- Create: `services/execution/broker-alpaca-adpt/src/repositories/order-mapping.repository.ts`
- Create: `services/execution/broker-alpaca-adpt/src/repositories/polling-state.repository.ts`
- Create: `services/execution/broker-alpaca-adpt/test/order-mapping.repository.test.ts`
- Create: `services/execution/broker-alpaca-adpt/test/polling-state.repository.test.ts`

- [ ] **Step 1: Write tests and implement OrderMappingRepository**

Methods: `createMapping(nestfolioOrderId, alpacaOrderId)`, `getByNestfolioOrderId`, `getByAlpacaOrderId`, `updateStatus`

- [ ] **Step 2: Write tests and implement PollingStateRepository**

Methods: `getState(tenantId)`, `updateLastCheckedAt`, `incrementOpenOrderCount`, `decrementOpenOrderCount`

- [ ] **Step 3: Run all tests**

```bash
pnpm nx run broker-alpaca-adpt:test
```

- [ ] **Step 4: Commit**

```bash
git add services/execution/broker-alpaca-adpt/ && git commit -m "feat(broker-alpaca-adpt): implement OrderMapping and PollingState repositories"
```

### Task 3.4: Implement order services

**Files:**
- Create: `services/execution/broker-alpaca-adpt/src/services/alpaca-orders.service.ts`
- Create: `services/execution/broker-alpaca-adpt/test/alpaca-orders.service.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:
- `submitOrder` — calls AlpacaClient.submitOrder → writes OrderMapping → returns WriteIntent for ALPACA_ORDER_PLACED record
- `submitOrder` failure — returns WriteIntent for ALPACA_ORDER_REJECTED record with raw error

- [ ] **Step 2: Implement AlpacaOrdersService**

- [ ] **Step 3: Run tests, commit**

```bash
pnpm nx run broker-alpaca-adpt:test && git add services/execution/broker-alpaca-adpt/ && git commit -m "feat(broker-alpaca-adpt): implement order submission service"
```

### Task 3.5: Implement event-listener handler

**Files:**
- Create: `services/execution/broker-alpaca-adpt/src/handlers/event-listener.ts`
- Create: `services/execution/broker-alpaca-adpt/test/event-listener.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:
- ALPACA_ORDER_REQUESTED → calls AlpacaOrdersService.submitOrder → writes DDB record
- ALPACA_ORDER_CANCEL_REQUESTED → calls AlpacaClient.cancelOrder → writes DDB record
- ALPACA_TRANSFER_REQUESTED → calls AlpacaClient.initiateTransfer → writes DDB record
- ALPACA_ACCOUNT_CHECK → calls AlpacaClient.getAccount + getPositions → writes snapshot record

- [ ] **Step 2: Implement handler using materializeToTable**

```typescript
export const handler = materializeToTable({
  handlers: {
    [AlpacaAdptEventTypes.ALPACA_ORDER_REQUESTED]: processOrderRequested,
    [AlpacaAdptEventTypes.ALPACA_ORDER_CANCEL_REQUESTED]: processCancelRequested,
    [AlpacaAdptEventTypes.ALPACA_TRANSFER_REQUESTED]: processTransferRequested,
    [AlpacaAdptEventTypes.ALPACA_ACCOUNT_CHECK]: processAccountCheck,
  },
});
```

- [ ] **Step 3: Run tests, commit**

```bash
pnpm nx run broker-alpaca-adpt:test && git add services/execution/broker-alpaca-adpt/ && git commit -m "feat(broker-alpaca-adpt): implement event-listener handler"
```

### Task 3.6: Implement trade event poller

**Files:**
- Create: `services/execution/broker-alpaca-adpt/src/handlers/trade-event-poller.ts`
- Create: `services/execution/broker-alpaca-adpt/test/trade-event-poller.test.ts`

This Lambda is triggered by EventBridge Scheduler while orders are in-flight.

- [ ] **Step 1: Write failing tests**

Test cases:
- Polls Alpaca trade events since lastCheckedAt → matches to Nestfolio orders → writes fill records
- No new events → updates lastCheckedAt only
- Zero open orders after processing → disables scheduler (or signals to disable)

- [ ] **Step 2: Implement poller**

```typescript
export async function handler() {
  const pollingState = await pollingRepo.getState(tenantId);
  if (!pollingState || pollingState.openOrderCount === 0) return;

  const now = new Date().toISOString();
  const events = await alpacaClient.getTradeEvents(pollingState.lastCheckedAt, now);

  for (const event of events) {
    const mapping = await orderMappingRepo.getByAlpacaOrderId(event.order.id);
    if (!mapping) continue;

    // Write fill/rejection record → CDC emits ALPACA_ORDER_FILLED etc.
    await writeTradeResult(mapping, event);
  }

  await pollingRepo.updateLastCheckedAt(tenantId, now);
}
```

- [ ] **Step 3: Run tests, commit**

```bash
pnpm nx run broker-alpaca-adpt:test && git add services/execution/broker-alpaca-adpt/ && git commit -m "feat(broker-alpaca-adpt): implement trade event poller"
```

### Task 3.7: Implement CDC event-publisher and wire service stack

**Files:**
- Create: `services/execution/broker-alpaca-adpt/src/handlers/event-publisher.ts`
- Modify: `services/execution/broker-alpaca-adpt/src/service.stack.ts`

- [ ] **Step 1: Implement event-publisher with customEventTypeMap**

Map DDB entity types to Alpaca-specific events:
```typescript
export const handler = changeDataCapture({
  serviceName: 'broker-alpaca-adpt',
  eventTypeMap: {
    'AlpacaOrderResult:INSERT': (record) => {
      const status = record.dynamodb?.NewImage?.status?.S;
      switch (status) {
        case 'PLACED': return AlpacaAdptEventTypes.ALPACA_ORDER_PLACED;
        case 'FILLED': return AlpacaAdptEventTypes.ALPACA_ORDER_FILLED;
        case 'PARTIALLY_FILLED': return AlpacaAdptEventTypes.ALPACA_ORDER_PARTIALLY_FILLED;
        case 'REJECTED': return AlpacaAdptEventTypes.ALPACA_ORDER_REJECTED;
        case 'CANCELLED': return AlpacaAdptEventTypes.ALPACA_ORDER_CANCELLED;
        case 'CANCEL_FAILED': return AlpacaAdptEventTypes.ALPACA_ORDER_CANCEL_FAILED;
        default: return `ALPACA_ORDER_${status}`;
      }
    },
    'AlpacaTransferResult:INSERT': (record) => { /* similar mapping */ },
    'AlpacaAccountSnapshot:INSERT': AlpacaAdptEventTypes.ALPACA_ACCOUNT_SNAPSHOT,
  },
});
```

- [ ] **Step 2: Wire service.stack.ts**

Configure: State, Ingress (4 event types), Egress (CDC), EventBridge Scheduler for polling. Inject Alpaca credentials via SSM/Secrets Manager as Lambda environment variables.

- [ ] **Step 3: Run all tests, commit**

```bash
pnpm nx run broker-alpaca-adpt:test && git add services/execution/broker-alpaca-adpt/ && git commit -m "feat(broker-alpaca-adpt): implement CDC publisher and wire service stack"
```

---

## Phase 4: Cross-domain wiring

### Task 4.1: Update execution-adpt forwarding rules

**Files:**
- Modify: `services/execution/execution-adpt/src/service.stack.ts`
- Modify: `services/execution/execution-adpt/src/domain/events.ts`

- [ ] **Step 1: Add new event types to ExecutionCrossDomainEventTypes**

Add: `ORDER_ESCALATED`, `BROKER_CIRCUIT_OPEN`, `ALPACA_ACCOUNT_VERIFIED`, `ALPACA_ACCOUNT_VERIFICATION_FAILED`

- [ ] **Step 2: Add forwarding rules to InvestorBus**

Add `ORDER_ESCALATED` and `BROKER_CIRCUIT_OPEN` to the ToInvestor rule.

- [ ] **Step 3: Run existing tests to verify no regressions**

```bash
pnpm nx run execution-adpt:test
```

- [ ] **Step 4: Commit**

```bash
git add services/execution/execution-adpt/ && git commit -m "feat(execution-adpt): add forwarding rules for ORDER_ESCALATED and BROKER_CIRCUIT_OPEN"
```

### Task 4.2: Update investor-adpt forwarding rules

**Files:**
- Modify: `services/investor/investor-adpt/src/service.stack.ts`
- Modify: `services/investor/investor-adpt/src/domain/events.ts`

- [ ] **Step 1: Add EXECUTION_MODE_CHANGED to InvestorCrossDomainEventTypes**

- [ ] **Step 2: Add forwarding rule to ExecutionBus**

```typescript
new Rule(this, 'ToExecution', {
  eventBus: investorBus,
  eventPattern: {
    detailType: ['EXECUTION_MODE_CHANGED'],
  },
  targets: [new EventBusTarget(executionBus, { deadLetterQueue: toExecutionDlq })],
});
```

- [ ] **Step 3: Run tests, commit**

```bash
pnpm nx run investor-adpt:test && git add services/investor/investor-adpt/ && git commit -m "feat(investor-adpt): add EXECUTION_MODE_CHANGED forwarding to ExecutionBus"
```

### Task 4.3: Add executionMode to InvestorProfile in investor-bff

**Files:**
- Modify: `services/investor/investor-bff/src/domain/models.ts`
- Modify: `services/investor/investor-bff/src/repositories/investor-profile.repository.ts`
- Modify: `services/investor/investor-bff/src/handlers/event-publisher.ts` (if CDC mapping needed)
- Modify: relevant test files

- [ ] **Step 1: Add executionMode field to InvestorProfile model**

```typescript
executionMode: 'simulation' | 'live';  // default: 'simulation'
```

- [ ] **Step 2: Update repository to include executionMode in createProfile (default: 'simulation')**

- [ ] **Step 3: Add CDC mapping for EXECUTION_MODE_CHANGED**

When `InvestorProfile` is modified and `executionMode` field changed → emit `EXECUTION_MODE_CHANGED`.

- [ ] **Step 4: Run tests, commit**

```bash
pnpm nx run investor-bff:test && git add services/investor/investor-bff/ && git commit -m "feat(investor-bff): add executionMode field to InvestorProfile"
```

---

## Phase 5: TaxLotManager in ledger-ctrl

### Task 5.1: Implement TaxLotManager

**Files:**
- Create: `services/ledger/ledger-ctrl/src/services/tax-lot-manager.ts`
- Create: `services/ledger/ledger-ctrl/test/tax-lot-manager.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:
- `openLot` — creates TaxLot record with quantity, costBasisPerShare, acquiredAt
- `closeLots` FIFO — sells 80 shares, consumes oldest lots first, creates DispositionRecords
- `closeLots` — correctly calculates realizedGain (positive and negative)
- `closeLots` — correctly determines holdingPeriod (short-term < 1 year, long-term >= 1 year)
- `closeLots` — marks lots as closed when fully consumed
- `closeLots` — partial lot consumption (updates remaining quantity)
- `getLotsBySymbol` — returns open lots ordered by acquiredAt
- `getDispositions` — returns dispositions for a given year
- `getUnrealizedGains` — calculates unrealized gains across open lots

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm nx run ledger-ctrl:test -- --testPathPattern=tax-lot-manager
```

- [ ] **Step 3: Implement TaxLotManager**

```typescript
export class TaxLotManager {
  constructor(private readonly repo: TaxLotRepository) {}

  async openLot(params: OpenLotParams): Promise<WriteIntent> { /* ... */ }

  async closeLots(params: CloseLotParams): Promise<DispositionRecord[]> {
    const lots = await this.repo.getOpenLotsBySymbol(params.tenantId, params.symbol);
    // FIFO: sorted by acquiredAt ascending (ulid ensures this)
    const dispositions: DispositionRecord[] = [];
    let remainingToSell = params.qty;

    for (const lot of lots) {
      if (remainingToSell <= 0) break;
      const qtyFromThisLot = Math.min(lot.quantity, remainingToSell);
      // ... compute gain, holding period, create disposition
    }
    return dispositions;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add services/ledger/ledger-ctrl/ && git commit -m "feat(ledger-ctrl): implement TaxLotManager with FIFO lot tracking"
```

### Task 5.2: Integrate TaxLotManager into ledger-ctrl event-listener

**Files:**
- Modify: `services/ledger/ledger-ctrl/src/handlers/event-listener.ts`
- Modify: `services/ledger/ledger-ctrl/test/event-listener.test.ts`

- [ ] **Step 1: Write failing tests**

Test cases:
- ORDER_FILLED with executionMode='live' and side=BUY → TaxLotManager.openLot called
- ORDER_FILLED with executionMode='live' and side=SELL → TaxLotManager.closeLots called
- ORDER_FILLED with executionMode='simulation' → TaxLotManager NOT called
- ORDER_FILLED without executionMode field → TaxLotManager NOT called (backward compat)

- [ ] **Step 2: Update event-listener to invoke TaxLotManager**

In the `processActualEvent` handler, after `accountReducer.apply()`:
```typescript
if (payload.executionMode === 'live') {
  if (payload.side === 'BUY') {
    await taxLotManager.openLot({ ... });
  } else if (payload.side === 'SELL') {
    await taxLotManager.closeLots({ ... });
  }
}
```

- [ ] **Step 3: Run all ledger-ctrl tests**

```bash
pnpm nx run ledger-ctrl:test
```

- [ ] **Step 4: Commit**

```bash
git add services/ledger/ledger-ctrl/ && git commit -m "feat(ledger-ctrl): integrate TaxLotManager for live fills"
```

---

## Phase 6: reconciliation-ctrl update

### Task 6.1: Add ALPACA_ACCOUNT_SNAPSHOT subscription

**Files:**
- Modify: `services/ledger/reconciliation-ctrl/src/service.stack.ts`
- Modify: `services/ledger/reconciliation-ctrl/src/handlers/event-listener.ts`
- Modify: `services/ledger/reconciliation-ctrl/test/event-listener.test.ts`

- [ ] **Step 1: Write failing test**

Test: receives ALPACA_ACCOUNT_SNAPSHOT → extracts broker-reported positions → triggers reconciliation comparison

- [ ] **Step 2: Add ALPACA_ACCOUNT_SNAPSHOT to Ingress eventTypes**

- [ ] **Step 3: Add handler in event-listener.ts**

Map ALPACA_ACCOUNT_SNAPSHOT to existing reconciliation flow (same as PORTFOLIO_SNAPSHOT_IMPORTED).

- [ ] **Step 4: Run tests, commit**

```bash
pnpm nx run reconciliation-ctrl:test && git add services/ledger/reconciliation-ctrl/ && git commit -m "feat(reconciliation-ctrl): add ALPACA_ACCOUNT_SNAPSHOT subscription"
```

---

## Phase 7: Go Live re-onboarding UX

### Task 7.1: Add flowType to onboarding-bff

**Files:**
- Modify: `services/investor/onboarding-bff/src/domain/models.ts`
- Modify: `services/investor/onboarding-bff/src/services/` (onboarding session/wizard logic)
- Modify relevant test files

- [ ] **Step 1: Add flowType field to OnboardingSession**

```typescript
flowType: 'initial' | 'go-live';  // default: 'initial'
```

- [ ] **Step 2: Implement go-live phase definitions**

Define phases for `flowType: 'go-live'`:
1. Review risk profile (reuse existing phase, pre-fill)
2. Review goals (reuse existing phase, pre-fill)
3. Review mandate & guardrails (reuse existing phase, pre-fill)
4. Fund account (new phase)
5. Confirmation (new phase)

- [ ] **Step 3: Implement GO_LIVE_CONFIRMED event emission**

When the user confirms in Phase 5, write a record that CDC emits as `GO_LIVE_CONFIRMED`.

- [ ] **Step 4: Run tests, commit**

```bash
pnpm nx run onboarding-bff:test && git add services/investor/onboarding-bff/ && git commit -m "feat(onboarding-bff): add go-live re-onboarding flow"
```

### Task 7.2: Add GO_LIVE_CONFIRMED handler to investor-bff

**Files:**
- Modify: `services/investor/investor-bff/src/handlers/event-listener.ts`
- Modify: `services/investor/investor-bff/test/event-listener.test.ts`

- [ ] **Step 1: Write failing test**

Test: receives GO_LIVE_CONFIRMED → updates InvestorProfile.executionMode to 'live' → CDC emits EXECUTION_MODE_CHANGED

- [ ] **Step 2: Implement handler**

- [ ] **Step 3: Run tests, commit**

```bash
pnpm nx run investor-bff:test && git add services/investor/investor-bff/ && git commit -m "feat(investor-bff): handle GO_LIVE_CONFIRMED to switch execution mode"
```

### Task 7.3: Implement Go Live UX in investor-mfe

**Files:**
- Create/Modify: `apps/investor-mfe/src/app/settings/` (Go Live screens)

- [ ] **Step 1: Add "Switch to Live Trading" CTA on settings page**

Only visible when `executionMode === 'simulation'`.

- [ ] **Step 2: Implement Go Live wizard screens**

5 screens as defined in spec Section 7:
- Screen 1: Review Risk Profile (reuse onboarding component, pre-fill)
- Screen 2: Review Goals (reuse onboarding component, pre-fill)
- Screen 3: Review Mandate & Guardrails (reuse onboarding component, pre-fill)
- Screen 4: Fund Account (verify Alpaca connection, enter amount, initiate transfer, show status)
- Screen 5: Confirmation (summary + warning + confirm button)

- [ ] **Step 3: Wire screens to onboarding-bff GraphQL mutations**

Use the existing onboarding Apollo client with `flowType: 'go-live'`.

- [ ] **Step 4: Run MFE tests**

```bash
pnpm nx run investor-mfe:test
```

- [ ] **Step 5: Commit**

```bash
git add apps/investor-mfe/ && git commit -m "feat(investor-mfe): implement Go Live re-onboarding wizard"
```

### Task 7.4: Add LIVE badge to dashboard-bff

**Files:**
- Modify: `services/investor/dashboard-bff/src/handlers/event-listener.ts`
- Modify: relevant dashboard-mfe components

- [ ] **Step 1: Materialize executionMode from EXECUTION_MODE_CHANGED**

In dashboard-bff event-listener, add handler for `EXECUTION_MODE_CHANGED` → write materialized view record.

- [ ] **Step 2: Add LIVE/SIM badge to dashboard-mfe**

Read executionMode from dashboard data, show badge in header.

- [ ] **Step 3: Run tests, commit**

```bash
pnpm nx run dashboard-bff:test && pnpm nx run dashboard-mfe:test && git add services/investor/dashboard-bff/ apps/dashboard-mfe/ && git commit -m "feat(dashboard): show LIVE/SIM execution mode badge"
```

---

## Phase 8: End-to-end verification

### Task 8.1: Run all tests across affected services

- [ ] **Step 1: Run all tests**

```bash
pnpm nx run-many -t test -p broker-sim-adpt,broker-ctrl,broker-alpaca-adpt,execution-adpt,investor-adpt,investor-bff,ledger-ctrl,reconciliation-ctrl,onboarding-bff,dashboard-bff
```

- [ ] **Step 2: Run lint across affected services**

```bash
pnpm nx run-many -t lint -p broker-sim-adpt,broker-ctrl,broker-alpaca-adpt,execution-adpt,investor-adpt,investor-bff,ledger-ctrl,reconciliation-ctrl,onboarding-bff,dashboard-bff
```

- [ ] **Step 3: Fix any failures**

- [ ] **Step 4: Final commit**

```bash
git add -A && git commit -m "chore: fix lint and test issues across real money ops services"
```

### Task 8.2: CDK synth verification

- [ ] **Step 1: Verify CDK synth for all new/modified stacks**

```bash
npx cdk synth --app 'npx ts-node -r ./tools/register-paths.js services/execution/broker-ctrl/src/main.ts'
npx cdk synth --app 'npx ts-node -r ./tools/register-paths.js services/execution/broker-sim-adpt/src/main.ts'
npx cdk synth --app 'npx ts-node -r ./tools/register-paths.js services/execution/broker-alpaca-adpt/src/main.ts'
```

- [ ] **Step 2: Review generated CloudFormation for correctness**

Verify:
- SF state machine definition is correct
- EventBridge rules target the right buses
- DDB tables have correct key schemas
- Lambda environment variables include TABLE_NAME, BUS_NAME, ALPACA_* vars
- IAM permissions are scoped correctly

- [ ] **Step 3: Commit any fixes**
