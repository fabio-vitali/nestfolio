# Handler–Pipeline Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor all service event-listener and event-publisher handlers to use the correct `@nestfolio/event-processor` abstraction level, aligning with the 3-role architecture (BFF/Controller/Adapter).

**Architecture:** Controllers migrate from imperative `skip()` + repository writes to declarative WriteIntents. Two services with complex persistence (broker-adpt, ledger-ctrl) move to engine-level `createIngestionHandler`. Five scheduled adapters normalize to the standard 3-Lambda pattern (event-listener + event-publisher + DDB table). BFFs get DI standardization.

**Tech Stack:** TypeScript, `@nestfolio/event-processor` (materializeToTable, createIngestionHandler, changeDataCapture, record/update/project/skip intents), Jest + createTestHarness, AWS CDK (Ingress/Egress/State constructs)

**Spec:** `docs/superpowers/specs/2026-03-23-handler-pipeline-alignment-design.md`

---

## Wave 1: Quick Wins (Pipeline Swaps + BFF DI)

Low-risk, mechanical changes. No logic changes. Run `pnpm nx run-many -t test --all` after each task to verify zero regressions.

### Task 1: broker-adpt → `createIngestionHandler`

**Files:**
- Modify: `services/execution/broker-adpt/src/handlers/event-listener.ts`

- [ ] **Step 1: Update import and pipeline factory**

Replace the `materializeToTable` import and call with `createIngestionHandler`. The handler code stays identical — only the wiring line changes.

```typescript
// Before
import { materializeToTable, skip, ... } from '@nestfolio/event-processor';
// ...
export const handler = materializeToTable({
  serviceName: 'broker-adpt',
  handlers: createHandlers({ repository, simulationEngine }),
  errorEventType: 'EXECUTION_ADPT_FAILED',
});

// After
import { createIngestionHandler, skip, ... } from '@nestfolio/event-processor';
// ...
export const handler = createIngestionHandler({
  serviceName: 'broker-adpt',
  handlers: createHandlers({ repository, simulationEngine }),
  errorEventType: 'EXECUTION_ADPT_FAILED',
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm nx test broker-adpt`
Expected: all existing tests pass (handler logic is unchanged)

- [ ] **Step 3: Commit**

```bash
git add services/execution/broker-adpt/src/handlers/event-listener.ts
git commit -m "refactor(broker-adpt): materializeToTable → createIngestionHandler

Adapter owns complex persistence (TransactWrite + guarded writes).
Engine-level API is the correct abstraction for custom atomic operations."
```

---

### Task 2: ledger-ctrl → `createIngestionHandler`

**Files:**
- Modify: `services/ledger/ledger-ctrl/src/handlers/event-listener.ts`

- [ ] **Step 1: Update import and pipeline factory**

Same pattern as Task 1:

```typescript
// Before
import { materializeToTable, skip, ... } from '@nestfolio/event-processor';
// ...
export const handler = materializeToTable({
  serviceName: 'ledger-ctrl',
  handlers: createHandlers({ repository, shadowFill }),
  errorEventType: 'LEDGER_CTRL_FAILED',
});

// After
import { createIngestionHandler, skip, ... } from '@nestfolio/event-processor';
// ...
export const handler = createIngestionHandler({
  serviceName: 'ledger-ctrl',
  handlers: createHandlers({ repository, shadowFill }),
  errorEventType: 'LEDGER_CTRL_FAILED',
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm nx test ledger-ctrl`
Expected: all existing tests pass

- [ ] **Step 3: Commit**

```bash
git add services/ledger/ledger-ctrl/src/handlers/event-listener.ts
git commit -m "refactor(ledger-ctrl): materializeToTable → createIngestionHandler

Event sourcing writes need atomic sequence increment + conditional put.
Engine-level API is correct for read-compute-write cycles."
```

---

### Task 3: advisory-bff DI standardization

**Files:**
- Modify: `services/advisory/advisory-bff/src/handlers/event-listener.ts`
- Create: `services/advisory/advisory-bff/test/handlers/event-listener.test.ts`

- [ ] **Step 1: Write test for createHandlers factory**

```typescript
import { createHandlers } from '../../src/handlers/event-listener';

// Mock the transform functions
jest.mock('../../src/transforms/decision-packet-created', () => ({
  decisionPacketCreated: jest.fn(() => ({ _tag: 'project', typename: 'DecisionReadModel', fields: {} })),
}));
jest.mock('../../src/transforms/decision-status-changed', () => ({
  decisionStatusChanged: jest.fn(() => ({ _tag: 'update', typename: 'DecisionReadModel', updates: {} })),
}));

describe('advisory-bff event-listener', () => {
  it('should export handlers for all event types', () => {
    const handlers = createHandlers();
    expect(Object.keys(handlers)).toHaveLength(5);
    expect(handlers).toHaveProperty('DECISION_PACKET_CREATED');
    expect(handlers).toHaveProperty('DECISION_PACKET_ENRICHED');
    expect(handlers).toHaveProperty('DECISION_APPROVED');
    expect(handlers).toHaveProperty('DECISION_BLOCKED');
    expect(handlers).toHaveProperty('USER_CONFIRMATION_REQUESTED');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test advisory-bff -- --testPathPattern=event-listener`
Expected: FAIL — `createHandlers` is not exported

- [ ] **Step 3: Wrap handlers in createHandlers factory**

Refactor `event-listener.ts` to export a `createHandlers()` factory:

```typescript
import { materializeToTable, toUow } from '@nestfolio/event-processor';
import { AdvisoryCtrlEventTypes } from '@nestfolio/advisory-ctrl/events';
import { ComplianceEventTypes } from '@nestfolio/compliance-ctrl/events';
import { decisionPacketCreated } from '../transforms/decision-packet-created';
import { decisionStatusChanged } from '../transforms/decision-status-changed';

export function createHandlers() {
  return {
    [AdvisoryCtrlEventTypes.DECISION_PACKET_CREATED]: (payload, ctx) =>
      decisionPacketCreated(toUow(payload, ctx) as any),
    [AdvisoryCtrlEventTypes.DECISION_PACKET_ENRICHED]: (payload, ctx) =>
      decisionStatusChanged(toUow(payload, ctx) as any),
    [ComplianceEventTypes.DECISION_APPROVED]: (payload, ctx) =>
      decisionStatusChanged(toUow(payload, ctx) as any),
    [ComplianceEventTypes.DECISION_BLOCKED]: (payload, ctx) =>
      decisionStatusChanged(toUow(payload, ctx) as any),
    [AdvisoryCtrlEventTypes.USER_CONFIRMATION_REQUESTED]: (payload, ctx) =>
      decisionStatusChanged(toUow(payload, ctx) as any),
  };
}

export const handler = materializeToTable({
  serviceName: 'advisory-bff',
  handlers: createHandlers(),
  errorEventType: 'ADVISORY_BFF_FAILED',
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm nx test advisory-bff`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/advisory/advisory-bff/src/handlers/event-listener.ts services/advisory/advisory-bff/test/handlers/event-listener.test.ts
git commit -m "refactor(advisory-bff): add createHandlers DI factory to event-listener"
```

---

### Task 4: investor-bff DI standardization

**Files:**
- Modify: `services/investor/investor-bff/src/handlers/event-listener.ts`
- Create: `services/investor/investor-bff/test/handlers/event-listener.test.ts`

Same pattern as Task 3. Wrap existing inline handler map in `createHandlers()`. Test that all 3 event types (USER_REGISTERED, NOTIFICATION_CREATED, BALANCE_UPDATED) are present.

- [ ] **Step 1: Write test for createHandlers factory**

Mock transforms (`user-registered`, `notification-created`, `balance-updated`). Assert 3 handlers exported with correct event type keys.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx test investor-bff -- --testPathPattern=event-listener`

- [ ] **Step 3: Wrap handlers in createHandlers factory**

- [ ] **Step 4: Run tests**

Run: `pnpm nx test investor-bff`

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor(investor-bff): add createHandlers DI factory to event-listener"
```

---

### Task 5: dashboard-bff DI standardization

**Files:**
- Modify: `services/investor/dashboard-bff/src/handlers/event-listener.ts`
- Create: `services/investor/dashboard-bff/test/handlers/event-listener.test.ts`

Same pattern. Wrap existing 13-event handler map in `createHandlers()`. Test all event type keys.

- [ ] **Step 1–5:** Follow Task 3 pattern. Dashboard-bff has 13 event types across 6 transforms.

```bash
git commit -m "refactor(dashboard-bff): add createHandlers DI factory to event-listener"
```

---

### Task 6: ledger-bff DI standardization

**Files:**
- Modify: `services/ledger/ledger-bff/src/handlers/event-listener.ts`
- Create: `services/ledger/ledger-bff/test/handlers/event-listener.test.ts`

Same pattern. Wrap existing 3-event handler map in `createHandlers()`.

- [ ] **Step 1–5:** Follow Task 3 pattern. Test 3 event types (BALANCE_UPDATED, PORTFOLIO_UPDATED, LEDGER_ENTRY_RECORDED).

```bash
git commit -m "refactor(ledger-bff): add createHandlers DI factory to event-listener"
```

---

### Task 7: Wave 1 verification

- [ ] **Step 1: Run all tests**

Run: `pnpm nx run-many -t test --all`
Expected: all projects pass

- [ ] **Step 2: Commit wave marker (if not already committed)**

---

## Wave 2: Controller WriteIntent Migration

Medium risk. Each controller's handlers are refactored from `skip()` + imperative repository writes to returning `WriteIntent`s. The pipeline's `IntentExecutor` then handles DDB writes.

**Pattern for each controller:**
1. Read the current handler + lifecycle service/repository
2. Write tests asserting returned WriteIntent shapes
3. Refactor handler to compute intent fields and return `record()`/`update()`/`project()` intents
4. Remove repository write calls from handler (keep reads if needed)
5. Verify existing + new tests pass

**Test pattern for WriteIntent handlers:**
```typescript
import { createHandlers, type EventListenerDeps } from '../../src/handlers/event-listener';
import type { EventPayload, EventContext } from '@nestfolio/event-processor';

const baseCtx = (overrides = {}): EventContext => ({
  eventId: 'evt-1', eventType: 'TEST', tenantId: 'T1',
  timestamp: '2026-01-01T00:00:00Z', serviceName: 'test', record: {},
  ...overrides,
});

describe('handler returns WriteIntents', () => {
  it('should return record intent for EVENT_TYPE', async () => {
    const handlers = createHandlers(mockDeps);
    const result = await handlers['EVENT_TYPE']({ subject: {...} }, baseCtx({ eventType: 'EVENT_TYPE' }));
    expect(result).toMatchObject({ _tag: 'record', typename: 'EntityName', fields: expect.objectContaining({...}) });
  });
});
```

---

### Task 8: execution-ctrl → WriteIntents

**Files:**
- Modify: `services/execution/execution-ctrl/src/handlers/event-listener.ts`
- Modify: `services/execution/execution-ctrl/test/event-listener.test.ts`
- Read (reference): `services/execution/execution-ctrl/src/services/order-lifecycle.service.ts`

**Context:** execution-ctrl currently calls `lifecycleService.processApprovedDecision()` which:
1. Creates Order via conditional put (idempotent)
2. Runs safetyChecks (pure computation)
3. Updates order status based on safety result + market hours
4. Optionally creates StagedOrder if market is closed

The handler needs to perform these computations inline and return the appropriate WriteIntents.

- [ ] **Step 1: Read current lifecycle service**

Read: `services/execution/execution-ctrl/src/services/order-lifecycle.service.ts`
Understand all fields written to Order and StagedOrder entities, including pk/sk layout.

- [ ] **Step 2: Write failing tests for WriteIntent returns**

Add tests to `test/event-listener.test.ts`:

```typescript
describe('DECISION_APPROVED handler', () => {
  it('should return record intents for orders when safety passes and market open', async () => {
    // Mock deps: safetyChecks passes, market is open
    const handlers = createHandlers(mockDeps);
    const result = await handlers['DECISION_APPROVED'](
      { subject: { decisionId: 'd1', tenantId: 'T1', proposedTrades: [{ orderId: 'o1', symbol: 'VTI', side: 'BUY', quantity: 10 }] } },
      baseCtx({ eventType: 'DECISION_APPROVED' }),
    );
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toMatchObject({ _tag: 'record', typename: 'Order' });
    expect(result[0].fields).toMatchObject({ orderId: 'o1', symbol: 'VTI', status: 'SUBMITTED' });
  });

  it('should return record with REJECTED status when safety fails', async () => {
    // Mock safetyChecks to fail
    // ...assert result[0].fields.status === 'REJECTED'
  });

  it('should return record + StagedOrder when market is closed', async () => {
    // Mock market closed
    // ...assert two intents: Order(STAGED) + StagedOrder
  });

  it('should return skip for CIRCUIT_BREAKER_TRIGGERED', async () => {
    const result = await handlers['CIRCUIT_BREAKER_TRIGGERED'](...);
    expect(result).toMatchObject({ _tag: 'skip' });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm nx test execution-ctrl -- --testPathPattern=event-listener`
Expected: FAIL — handlers still return `skip()`

- [ ] **Step 4: Refactor handler to return WriteIntents**

In `event-listener.ts`:
- Extract trade processing logic from lifecycle service into the handler (or a pure helper function)
- For DECISION_APPROVED / USER_CONFIRMED: compute order fields, run safety checks, check market hours → return appropriate `record('Order', {...})` and optionally `record('StagedOrder', {...})` intents
- For CIRCUIT_BREAKER_* and ACCOUNT_CLOSURE_REQUESTED: keep `skip()` (log-only)
- Update `EventListenerDeps` to include `safetyChecks` and `marketHours` services (for computation), remove `lifecycleService` and `repository`

```typescript
import { materializeToTable, record, skip, type EventPayload, type EventContext } from '@nestfolio/event-processor';

export interface EventListenerDeps {
  readonly safetyChecks: SafetyChecksService;
  readonly marketHours: MarketHoursService;
}

export function createHandlers(deps: EventListenerDeps) {
  const processDecision = async (payload: EventPayload, ctx: EventContext) => {
    const subject = payload.subject ?? {};
    const proposedTrades = (subject.proposedTrades as Trade[]) ?? [];
    if (!proposedTrades.length) return skip();

    const tenantId = ctx.tenantId;
    const decisionId = subject.decisionId as string;
    const safetyResult = deps.safetyChecks.runAllChecks(tenantId, proposedTrades);

    return proposedTrades.map(trade => {
      const pk = `Order#${tenantId}`;
      const sk = `Order#${trade.orderId}`;
      if (!safetyResult.passed) {
        return record('Order', {
          tenantId, decisionId, ...trade, status: 'REJECTED',
          rejectReason: safetyResult.reason,
        }, { overrides: { pk, sk } });
      }
      if (deps.marketHours.isMarketOpen()) {
        return record('Order', {
          tenantId, decisionId, ...trade, status: 'SUBMITTED',
        }, { overrides: { pk, sk } });
      }
      // Market closed — stage the order
      return [
        record('Order', { tenantId, decisionId, ...trade, status: 'STAGED' }, { overrides: { pk, sk } }),
        record('StagedOrder', { tenantId, decisionId, ...trade }, {
          overrides: { pk: `StagedOrder#${tenantId}`, sk: `StagedOrder#${trade.orderId}` },
        }),
      ];
    }).flat();
  };

  return {
    [AdvisoryCrossDomainEventTypes.DECISION_APPROVED]: processDecision,
    [AdvisoryCrossDomainEventTypes.USER_CONFIRMED]: processDecision,
    [AdvisoryCrossDomainEventTypes.CIRCUIT_BREAKER_TRIGGERED]: async () => skip(),
    [AdvisoryCrossDomainEventTypes.CIRCUIT_BREAKER_RESET]: async () => skip(),
    [AdvisoryCrossDomainEventTypes.ACCOUNT_CLOSURE_REQUESTED]: async () => skip(),
  };
}
```

> **Important:** Read the actual `OrderLifecycleService` and `OrderRepository` to get exact pk/sk layout, field names, and entity structure. The code above is a template — adapt to match the real entity schema.

- [ ] **Step 5: Run tests**

Run: `pnpm nx test execution-ctrl`
Expected: all tests pass (new + existing)

- [ ] **Step 6: Commit**

```bash
git add services/execution/execution-ctrl/
git commit -m "refactor(execution-ctrl): return WriteIntents instead of skip()

Handlers now return record() intents for Order/StagedOrder entities.
Pipeline's IntentExecutor owns DDB writes. Safety checks and market
hours remain as injected computation deps."
```

---

### Task 9: investor-ctrl → WriteIntents

**Files:**
- Modify: `services/investor/investor-ctrl/src/handlers/event-listener.ts`
- Modify: `services/investor/investor-ctrl/test/event-listener.test.ts`
- Read (reference): `services/investor/investor-ctrl/src/services/notification-lifecycle.service.ts`

**Context:** investor-ctrl calls `lifecycleService.executeNotificationLifecycle()` which:
1. Creates Notification via conditional put
2. Dispatches to channel (stubbed — just logs)
3. Updates notification status to DELIVERED/FAILED
4. Optionally creates MonthlyReport for ORDER_FILLED events

Refactoring: handler computes notification fields from event payload and returns `record('Notification', {...})`. The stubbed delivery service is dropped (it's a no-op). When real delivery is implemented, it will need reassessment.

- [ ] **Step 1: Read current lifecycle service**

Read: `services/investor/investor-ctrl/src/services/notification-lifecycle.service.ts`
Note: notification template mapping (which event → which title/body), pk/sk layout, MonthlyReport conditions.

- [ ] **Step 2: Write failing tests**

Test each of the 8 event types returns `record('Notification', {...})`. Test ORDER_FILLED also returns `record('MonthlyReport', {...})`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm nx test investor-ctrl -- --testPathPattern=event-listener`

- [ ] **Step 4: Refactor handler to return WriteIntents**

- Extract notification template mapping from lifecycle service into a pure function
- Handler: `(payload, ctx) => record('Notification', { tenantId, type: ctx.eventType, ...templateFields, status: 'DELIVERED' })`
- For ORDER_FILLED: return array `[record('Notification', ...), record('MonthlyReport', ...)]`
- Since delivery is stubbed, status goes directly to 'DELIVERED'
- `EventListenerDeps` becomes empty or contains only the template mapper

- [ ] **Step 5: Run tests**

Run: `pnpm nx test investor-ctrl`

- [ ] **Step 6: Commit**

```bash
git commit -m "refactor(investor-ctrl): return WriteIntents instead of skip()

Notification and MonthlyReport entities created via record() intents.
Stubbed delivery service removed (was no-op)."
```

---

### Task 10: advisory-ctrl → WriteIntents (PARTIAL)

**Files:**
- Modify: `services/advisory/advisory-ctrl/src/handlers/event-listener.ts`
- Modify: `services/advisory/advisory-ctrl/test/event-listener.test.ts`

**Context:** Only COMPLIANCE and USER handler groups migrate. TRIGGER handler stays imperative (calls `invokeOrchestrator` — external side-effect).

- [ ] **Step 1: Read current handler**

Read: `services/advisory/advisory-ctrl/src/handlers/event-listener.ts`
Note: exact pk/sk layout for DecisionPacket updates, field names for status/complianceResult/authorityLevel/userDecision.

- [ ] **Step 2: Write failing tests for COMPLIANCE/USER WriteIntents**

```typescript
describe('COMPLIANCE handlers return WriteIntents', () => {
  it('DECISION_APPROVED returns update intent', async () => {
    const handlers = createHandlers(mockDeps);
    const result = await handlers['DECISION_APPROVED']({
      subject: { decisionId: 'd1', tenantId: 'T1', authorityLevel: 'L1' },
    }, baseCtx({ eventType: 'DECISION_APPROVED' }));
    expect(result).toMatchObject({
      _tag: 'update', typename: 'DecisionPacket',
      updates: expect.objectContaining({ status: 'APPROVED', complianceResult: 'APPROVED' }),
    });
  });

  it('DECISION_BLOCKED returns update intent with blockReason', async () => { ... });
});

describe('USER handlers return WriteIntents', () => {
  it('USER_CONFIRMED returns update intent', async () => { ... });
  it('USER_REJECTED returns update intent', async () => { ... });
});

describe('TRIGGER handlers stay imperative', () => {
  it('MANDATE_GRANTED returns skip (lifecycle handles writes)', async () => {
    const result = await handlers['MANDATE_GRANTED'](...);
    expect(result).toMatchObject({ _tag: 'skip' });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm nx test advisory-ctrl -- --testPathPattern=event-listener`

- [ ] **Step 4: Refactor COMPLIANCE and USER handlers**

Replace repository-based status updates with `update()` WriteIntents:

```typescript
// COMPLIANCE handlers — now return WriteIntents
[ComplianceEventTypes.DECISION_APPROVED]: async (payload: EventPayload, ctx: EventContext) => {
  const subject = payload.subject ?? {};
  const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
  const decisionId = subject.decisionId as string;
  const authorityLevel = (subject.authorityLevel as string) ?? 'L2';
  return update('DecisionPacket', {
    status: authorityLevel === 'L1' ? 'APPROVED' : 'AWAITING_CONFIRMATION',
    complianceResult: 'APPROVED',
    authorityLevel,
  }, { overrides: { pk: `DecisionPacket#${tenantId}#${decisionId}`, sk: 'DecisionPacket' } });
},

// USER handlers — now return WriteIntents
[AdvisoryBffEventTypes.USER_CONFIRMED]: async (payload: EventPayload, ctx: EventContext) => {
  const subject = payload.subject ?? {};
  const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
  const decisionId = subject.decisionId as string;
  return update('DecisionPacket', {
    status: 'CONFIRMED', userDecision: 'CONFIRMED',
  }, { overrides: { pk: `DecisionPacket#${tenantId}#${decisionId}`, sk: 'DecisionPacket' } });
},

// TRIGGER handlers — unchanged (stay imperative with skip())
```

> **Important:** Read the actual handler to get exact pk/sk format, field names, and any edge cases (e.g., DECISION_BLOCKED with `blockReason`). Adapt the code above.

- [ ] **Step 5: Run tests**

Run: `pnpm nx test advisory-ctrl`

- [ ] **Step 6: Commit**

```bash
git commit -m "refactor(advisory-ctrl): COMPLIANCE/USER handlers → WriteIntents

TRIGGER handlers stay imperative (agent orchestration side-effect).
COMPLIANCE handlers return update() intents for DecisionPacket status.
USER handlers return update() intents for user decision."
```

---

### Task 11: compliance-ctrl → WriteIntents

**Files:**
- Modify: `services/advisory/compliance-ctrl/src/handlers/event-listener.ts`
- Modify: `services/advisory/compliance-ctrl/test/event-listener.test.ts`
- Read (reference): `services/advisory/compliance-ctrl/src/repositories/compliance.repository.ts`

**Context:** compliance-ctrl has two handler groups:
1. **DECISION events** → getMandateSnapshot (read) → ruleEngine.evaluate (pure) → write ComplianceCheck + AuditArtifact
2. **MANDATE events** → upsert/revoke MandateSnapshot

The handler keeps `repository` dep for reads (getMandateSnapshot) and `ruleEngine` for computation. Writes become intents.

Two-phase write (createComplianceCheck → updateCheckResult) collapses into single `record('ComplianceCheck', { ...allFields })` — this is an improvement (atomic, no partial state).

- [ ] **Step 1: Read current handler and repository**

Read: handler source + `compliance.repository.ts`. Note pk/sk layout for ComplianceCheck, AuditArtifact, MandateSnapshot (documented in repository code).

- [ ] **Step 2: Write failing tests**

Test DECISION event handler:
- Mock `deps.repository.getMandateSnapshot()` to return a mandate
- Mock `deps.ruleEngine.evaluate()` to return APPROVED/BLOCKED
- Assert returned intents: `[record('ComplianceCheck', {...}), record('AuditArtifact', {...})]`
- Test no-mandate case: assert `record('ComplianceCheck', { ...status: 'BLOCKED', reason: 'No mandate' })`

Test MANDATE event handlers:
- MANDATE_GRANTED → `project('MandateSnapshot', {...})`
- MANDATE_REVOKED → `update('MandateSnapshot', { status: 'REVOKED' })`

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm nx test compliance-ctrl -- --testPathPattern=event-listener`

- [ ] **Step 4: Refactor handler to return WriteIntents**

```typescript
export interface EventListenerDeps {
  readonly repository: { getMandateSnapshot: (tenantId: string, userId: string) => Promise<...> };
  readonly ruleEngine: RuleEngine;
}

export function createHandlers(deps: EventListenerDeps) {
  return {
    // DECISION events: read mandate → evaluate → return intents
    [AdvisoryCtrlEventTypes.DECISION_PACKET_CREATED]: async (payload, ctx) => {
      const subject = payload.subject ?? {};
      const tenantId = ctx.tenantId;
      const userId = subject.userId as string;
      const decisionId = subject.decisionId as string;
      const ccId = `${decisionId}-cc`;
      const pk = `ComplianceCheck#${tenantId}#${ccId}`;

      const mandate = await deps.repository.getMandateSnapshot(tenantId, userId);
      if (!mandate) {
        return record('ComplianceCheck', {
          tenantId, decisionPacketId: decisionId,
          result: 'BLOCKED', violations: [{ rule: 'mandate', message: 'No mandate' }],
          authorityLevel: 'L2',
        }, { overrides: { pk, sk: 'ComplianceCheck' } });
      }

      const output = deps.ruleEngine.evaluate({ ...subject, mandate });
      return [
        record('ComplianceCheck', {
          tenantId, decisionPacketId: decisionId,
          result: output.result, violations: output.violations,
          authorityLevel: output.authorityLevel, checks: output.checks,
        }, { overrides: { pk, sk: 'ComplianceCheck' } }),
        record('AuditArtifact', {
          tenantId, complianceCheckId: ccId,
          input: { ...subject, mandate },
          output,
        }, { overrides: { pk, sk: `AuditArtifact#${ccId}-audit` } }),
      ];
    },
    // ... DECISION_PACKET_ENRICHED: same handler

    // MANDATE events: upsert/revoke mandate snapshot
    [InvestorEventTypes.MANDATE_GRANTED]: async (payload, ctx) => {
      const subject = payload.subject ?? {};
      return project('MandateSnapshot', {
        tenantId: ctx.tenantId, userId: subject.userId, ...subject,
      }, { pk: `GuardrailPolicy#${ctx.tenantId}#${subject.userId}`, sk: 'MandateSnapshot' });
    },
    // ... MANDATE_UPDATED, MANDATE_REVOKED, OPERATING_MODE_CHANGED
  };
}
```

> **Important:** Read actual pk/sk layout from `compliance.repository.ts` and adapt. The code above shows the pattern — field names and key formats must match the existing DDB schema.

- [ ] **Step 5: Run tests**

Run: `pnpm nx test compliance-ctrl`

- [ ] **Step 6: Commit**

```bash
git commit -m "refactor(compliance-ctrl): return WriteIntents instead of skip()

DECISION handlers: single record() replaces two-phase create+update.
MANDATE handlers: project() for upsert, update() for revoke.
Repository kept for getMandateSnapshot read only."
```

---

### Task 12: reconciliation-ctrl → WriteIntents

**Files:**
- Modify: `services/ledger/reconciliation-ctrl/src/handlers/event-listener.ts`
- Modify: `services/ledger/reconciliation-ctrl/src/services/reconciliation.service.ts`
- Modify: `services/ledger/reconciliation-ctrl/test/event-listener.test.ts`

**Context:** reconciliation-ctrl calls `reconciliationService.reconcile()` which:
1. Creates Reconciliation record (idempotent)
2. Computes drift per instrument
3. Creates DriftRecord per instrument
4. Updates reconciliation status

Refactoring: `reconciliationService.reconcile()` becomes a pure compute function returning `{ status, drifts[] }`. Handler converts results to WriteIntents.

- [ ] **Step 1: Read current service and repository**

Read: `reconciliation.service.ts` + `reconciliation.repository.ts`. Note pk/sk layout, entity structures.

- [ ] **Step 2: Write failing tests**

Test handler returns:
- `record('ReconciliationResult', {...})` + `record('DriftRecord', {...})[]` per drifted instrument
- For no-drift case: `record('ReconciliationResult', { status: 'COMPLETED' })` only

- [ ] **Step 3: Run tests to verify they fail**

- [ ] **Step 4: Refactor reconciliation service to pure computation**

Extract DDB writes from `reconciliationService.reconcile()`. It should return `{ status, drifts: Array<{ instrument, intentQty, settlementQty, drift }> }` without writing to DDB.

Refactor handler to convert results to intents:

```typescript
const reconcileHandler = async (payload: EventPayload, ctx: EventContext) => {
  const subject = payload.subject ?? {};
  const tenantId = ctx.tenantId;
  const reconciliationId = ctx.eventId;

  const result = deps.reconciliationService.reconcile({
    tenantId, portfolioId: subject.portfolioId,
    intentPositions: subject.intentPositions,
    settlementPositions: subject.settlementPositions,
  });

  const pk = `Reconciliation#${tenantId}#${reconciliationId}`;
  const intents = [
    record('ReconciliationResult', {
      tenantId, reconciliationId, status: result.status,
      driftCount: result.drifts.length,
    }, { overrides: { pk, sk: 'Reconciliation' } }),
    ...result.drifts.map(d =>
      record('DriftRecord', {
        tenantId, reconciliationId, ...d,
      }, { overrides: { pk, sk: `DriftRecord#${d.instrument}` } })
    ),
  ];

  return intents;
};
```

- [ ] **Step 5: Run tests**

Run: `pnpm nx test reconciliation-ctrl`

- [ ] **Step 6: Commit**

```bash
git commit -m "refactor(reconciliation-ctrl): return WriteIntents instead of skip()

reconciliationService.reconcile() becomes pure computation.
Handler converts results to record() intents for ReconciliationResult + DriftRecords."
```

---

### Task 13: Wave 2 verification

- [ ] **Step 1: Run all tests**

Run: `pnpm nx run-many -t test --all`
Expected: all projects pass

- [ ] **Step 2: Verify no regressions in event flow**

Check that CDC event types still match. The entities written by IntentExecutor must have the same `__typename` values that `changeDataCapture` expects in each service's `buildEventTypeMap`.

---

## Wave 3: Scheduled Adapter Normalization

High effort. Each of the 5 adapters transforms from a single scheduled Lambda to the standard 3-Lambda architecture (event-listener + event-publisher + DDB table).

**Pattern for each adapter:**
1. Create `event-listener.ts` with `materializeToTable` handler
2. Replace `event-publisher.ts` content with `changeDataCapture` CDC handler
3. Create domain barrel with entity types and event type constants
4. Update CDK stack: add `Ingress` + `Egress` + `State` constructs
5. Move fetch logic from old publisher to new listener handler
6. Write tests for both listener and publisher

### Task 14: alpha-vantage-adpt normalization (TEMPLATE)

This task establishes the pattern for all 5 adapters. Subsequent adapters follow the same structure.

**Files:**
- Create: `services/advisory/alpha-vantage-adpt/src/handlers/event-listener.ts`
- Modify: `services/advisory/alpha-vantage-adpt/src/handlers/event-publisher.ts` (replace content)
- Create: `services/advisory/alpha-vantage-adpt/src/domain/events.ts`
- Create: `services/advisory/alpha-vantage-adpt/src/domain/index.ts`
- Modify: `services/advisory/alpha-vantage-adpt/src/service.stack.ts`
- Create: `services/advisory/alpha-vantage-adpt/test/handlers/event-listener.test.ts`
- Create: `services/advisory/alpha-vantage-adpt/test/handlers/event-publisher.test.ts`
- Read (reference): current `event-publisher.ts` for fetch logic

- [ ] **Step 1: Read current adapter handler**

Read: `services/advisory/alpha-vantage-adpt/src/handlers/event-publisher.ts`
Note: API fetch logic, event payload structure, publishOrUpload usage.

- [ ] **Step 2: Create domain barrel with events and entity types**

```typescript
// src/domain/events.ts
export const AlphaVantageAdptEventTypes = {
  FETCH_REQUESTED: 'FETCH_ALPHA_VANTAGE_REQUESTED',
  ALPHA_VANTAGE_NEWS_UPDATED: 'ALPHA_VANTAGE_NEWS_UPDATED',
} as const;

export const AlphaVantageEntityTypes = ['AlphaVantageArticle', 'EconomicIndicator'] as const;
```

```typescript
// src/domain/index.ts
export * from './events';
```

- [ ] **Step 3: Write failing test for event-listener**

```typescript
import { createHandlers, type AlphaVantageDeps } from '../../src/handlers/event-listener';

const mockDeps: AlphaVantageDeps = {
  fetchNews: jest.fn().mockResolvedValue([
    { title: 'Market rally', summary: '...', source: 'AV', publishedAt: '...' },
  ]),
  fetchIndicators: jest.fn().mockResolvedValue([
    { series: 'REAL_GDP', value: 2.1, date: '2026-01-01' },
  ]),
};

describe('alpha-vantage-adpt event-listener', () => {
  it('should return record intents for news articles', async () => {
    const handlers = createHandlers(mockDeps);
    const result = await handlers['FETCH_ALPHA_VANTAGE_REQUESTED'](
      { subject: { tickers: ['VTI'] } },
      baseCtx({ eventType: 'FETCH_ALPHA_VANTAGE_REQUESTED' }),
    );
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toMatchObject({ _tag: 'record', typename: 'AlphaVantageArticle' });
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm nx test alpha-vantage-adpt -- --testPathPattern=event-listener`

- [ ] **Step 5: Create event-listener handler**

```typescript
// src/handlers/event-listener.ts
import { materializeToTable, record, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { requireEnv } from '@nestfolio/event-processor';
import { AlphaVantageAdptEventTypes } from '../domain/events';

export interface AlphaVantageDeps {
  readonly fetchNews: (tickers: string[]) => Promise<Array<Record<string, unknown>>>;
  readonly fetchIndicators: (series: string[]) => Promise<Array<Record<string, unknown>>>;
}

export function createHandlers(deps: AlphaVantageDeps) {
  return {
    [AlphaVantageAdptEventTypes.FETCH_REQUESTED]: async (payload: EventPayload, ctx: EventContext) => {
      const tickers = ['VTI', 'BND', 'QQQ', 'SPY']; // or from payload/env
      const series = ['REAL_GDP', 'CPI', 'FEDFUNDS', 'UNRATE', 'DGS10'];

      const [articles, indicators] = await Promise.all([
        deps.fetchNews(tickers),
        deps.fetchIndicators(series),
      ]);

      return [
        ...articles.map((a, i) => record('AlphaVantageArticle', {
          tenantId: 'SYSTEM', ...a, fetchedAt: ctx.timestamp,
        }, { pk: 'AlphaVantage#SYSTEM', sk: `Article#${ctx.eventId}#${i}` })),
        ...indicators.map((ind, i) => record('EconomicIndicator', {
          tenantId: 'SYSTEM', ...ind, fetchedAt: ctx.timestamp,
        }, { pk: 'AlphaVantage#SYSTEM', sk: `Indicator#${ctx.eventId}#${i}` })),
      ];
    },
  };
}

// Production wiring
const deps: AlphaVantageDeps = {
  fetchNews: /* extract from current event-publisher.ts */,
  fetchIndicators: /* extract from current event-publisher.ts */,
};

export const handler = materializeToTable({
  serviceName: 'alpha-vantage-adpt',
  handlers: createHandlers(deps),
  errorEventType: 'ALPHA_VANTAGE_ADPT_FAILED',
});
```

> **Important:** Extract the actual Alpha Vantage API fetch logic from the current `event-publisher.ts` into the `fetchNews`/`fetchIndicators` functions. Keep the HTTP client code, just move it into DI-injectable deps.

- [ ] **Step 6: Run event-listener test**

Run: `pnpm nx test alpha-vantage-adpt -- --testPathPattern=event-listener`
Expected: PASS

- [ ] **Step 7: Write event-publisher CDC test**

```typescript
// test/handlers/event-publisher.test.ts
// Verify the changeDataCapture config matches entity types
import { AlphaVantageEntityTypes } from '../../src/domain/events';

describe('alpha-vantage-adpt event-publisher', () => {
  it('should use changeDataCapture with correct entity types', () => {
    // This is a config-level test — verify the CDC mapping exists
    expect(AlphaVantageEntityTypes).toContain('AlphaVantageArticle');
    expect(AlphaVantageEntityTypes).toContain('EconomicIndicator');
  });
});
```

- [ ] **Step 8: Replace event-publisher with CDC handler**

```typescript
// src/handlers/event-publisher.ts
import { changeDataCapture, buildEventTypeMap } from '@nestfolio/event-processor';
import { AlphaVantageEntityTypes } from '../domain/events';

export const handler = changeDataCapture({
  serviceName: 'alpha-vantage-adpt',
  eventTypeMap: buildEventTypeMap([...AlphaVantageEntityTypes]),
});
```

- [ ] **Step 9: Update CDK stack**

Read: `services/advisory/alpha-vantage-adpt/src/service.stack.ts`

Replace the single `NodejsFunction` + `AdapterSchedule` pattern with the standard service construct pattern:

```typescript
// Add Ingress (SQS-backed Lambda for event-listener)
const ingress = new Ingress(this, 'Ingress', {
  eventTypes: [AlphaVantageAdptEventTypes.FETCH_REQUESTED],
  // Schedule rule publishes FETCH_REQUESTED to the bus on cron
});

// Add Egress (DDB Stream → CDC → EventBridge)
const egress = new Egress(this, 'Egress', {
  publishableTypes: [...AlphaVantageEntityTypes],
});

// The State table is provided by ServiceStack base class
// Wire ingress handler env vars (API keys, etc.)
ingress.handler.addEnvironment('ALPHA_VANTAGE_API_KEY', ...);
```

> **Important:** Read the existing CDK stack + `Ingress`/`Egress` construct APIs from the advisory-ctrl stack for the exact pattern. The EventBridge schedule rule needs to publish a `FETCH_REQUESTED` event to the bus (which routes to the SQS queue), rather than directly triggering a Lambda.

- [ ] **Step 10: Run all tests**

Run: `pnpm nx test alpha-vantage-adpt`

- [ ] **Step 11: Commit**

```bash
git add services/advisory/alpha-vantage-adpt/
git commit -m "refactor(alpha-vantage-adpt): normalize to 3-Lambda architecture

EventBridge Schedule → SQS → event-listener (materializeToTable) → DDB
→ event-publisher (changeDataCapture) → EventBridge.
Fetch logic extracted into DI-injectable deps."
```

---

### Task 15: fred-adpt normalization

**Files:**
- Create: `services/advisory/fred-adpt/src/handlers/event-listener.ts`
- Modify: `services/advisory/fred-adpt/src/handlers/event-publisher.ts`
- Create: `services/advisory/fred-adpt/src/domain/events.ts`
- Create: `services/advisory/fred-adpt/src/domain/index.ts`
- Modify: `services/advisory/fred-adpt/src/service.stack.ts`
- Create: `services/advisory/fred-adpt/test/handlers/event-listener.test.ts`

Follow Task 14 pattern exactly:

- [ ] **Step 1:** Read current `event-publisher.ts` for fetch logic (11 FRED series)
- [ ] **Step 2:** Create domain barrel (`FETCH_FRED_REQUESTED`, entity: `FredIndicator`)
- [ ] **Step 3:** Write event-listener test (mock `fetchIndicators`, assert `record('FredIndicator', ...)`)
- [ ] **Step 4:** Create event-listener handler (extract FRED API fetch into deps)
- [ ] **Step 5:** Replace event-publisher with `changeDataCapture(['FredIndicator'])`
- [ ] **Step 6:** Update CDK stack (Ingress + Egress + schedule rule)
- [ ] **Step 7:** Run tests: `pnpm nx test fred-adpt`
- [ ] **Step 8:** Commit

```bash
git commit -m "refactor(fred-adpt): normalize to 3-Lambda architecture"
```

---

### Task 16: marketwatch-adpt normalization

Follow Task 14 pattern. Entity: `MarketWatchArticle`. Fetch: 2 RSS feeds parsed with `parseRssFeed`.

- [ ] **Steps 1–8:** Follow Task 14 pattern. Extract RSS fetch + `parseRssFeed` into deps.

```bash
git commit -m "refactor(marketwatch-adpt): normalize to 3-Lambda architecture"
```

---

### Task 17: yahoo-finance-adpt normalization

Follow Task 14 pattern. Entity: `YahooFinanceArticle`. Fetch: per-ticker RSS feeds.

- [ ] **Steps 1–8:** Follow Task 14 pattern. Extract per-ticker RSS fetch into deps.

```bash
git commit -m "refactor(yahoo-finance-adpt): normalize to 3-Lambda architecture"
```

---

### Task 18: sec-edgar-adpt normalization

Follow Task 14 pattern. Entities: `SecFiling`. Events: `SEC_8K_FILED`, `SEC_PROSPECTUS_UPDATED`, `SEC_10K_UPDATED`. This adapter has the most complex fetch logic (EDGAR API + filing content retrieval).

- [ ] **Steps 1–8:** Follow Task 14 pattern. Entity type map needs custom overrides to produce different event types per filing form type.

```bash
git commit -m "refactor(sec-edgar-adpt): normalize to 3-Lambda architecture"
```

---

### Task 19: Wave 3 verification

- [ ] **Step 1: Run all tests**

Run: `pnpm nx run-many -t test --all`
Expected: all projects pass

- [ ] **Step 2: Verify CDK synth**

Run: `pnpm nx run-many -t synth --projects=alpha-vantage-adpt,fred-adpt,marketwatch-adpt,yahoo-finance-adpt,sec-edgar-adpt`
Expected: all stacks synthesize without errors (confirms Ingress/Egress/State construct wiring)

- [ ] **Step 3: Final commit**

```bash
git commit -m "chore: wave 3 complete — all scheduled adapters normalized to 3-Lambda"
```
