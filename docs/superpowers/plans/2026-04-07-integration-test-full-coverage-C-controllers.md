# Integration Test Full Coverage — Plan C: Controllers & Orchestration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand integration tests for 6 multi-handler services (advisory-ctrl, execution-ctrl, compliance-ctrl, broker-sim-adpt, advisory-bff, ledger-ctrl) and 2 orchestration services (broker-ctrl, decision-workflow-ctrl) to cover all handler paths with deterministic mock-based tests.

**Architecture:** Each service already has a starter integration test covering 1 handler path. This plan expands to cover all remaining paths: additional event types, agent mock paths, SF execution end-to-end, and AppSync mutations. Mock agents deployed via MockApiFixture. DdbSeedFixture pre-seeds required state for tests that depend on existing records.

**Tech Stack:** TypeScript, Jest, AWS Lambda (mock handlers), EventBridge, DynamoDB, SQS, Step Functions, AppSync

**Branch:** `feat/all-services-integration-tests` (continue from Plan B)

**Design Spec:** `docs/superpowers/specs/2026-04-07-integration-test-full-coverage-design.md`

**Pre-requisites (Plans A + B completed):**
- DdbSeedFixture at `libs/integration-testing/src/fixtures/ddb-seed.fixture.ts`
- TableAssertions has `registerCleanup()` with auto-tracking
- Mock handler pattern established (test/mocks/ → build-mock → zip → MockApiFixture)
- All fixtures available: EventBridgeClient, EventBusTrap, TableAssertions, MockApiFixture, SsmOverrideFixture, DdbSeedFixture, CognitoFixture, AppSyncClient, AccountSeedingFixture

**Task dependency:** Task 7 (decision-workflow-ctrl) depends on the mock agent pattern from Task 1 (advisory-ctrl). All other tasks are independent.

---

### Task 1: advisory-ctrl — Expand Integration Tests + Mock Agent

**Files:**
- Create: `services/advisory/advisory-ctrl/test/mocks/mock-agent-runtime.ts`
- Modify: `services/advisory/advisory-ctrl/project.json` — add `build-mock` target
- Rewrite: `services/advisory/advisory-ctrl/test/integration/advisory-ctrl.integration.test.ts`

**Context:** advisory-ctrl has 15 ingress subscriptions across 3 handler groups:
1. **Agent trigger path:** MANDATE_CREATED, GOAL_CREATED, GOAL_UPDATED, etc. → invoke LangGraph agent → DDB AgentInvocation + DecisionPacket writes
2. **Compliance callback path:** DECISION_APPROVED, DECISION_BLOCKED → update DecisionPacket status
3. **User response path:** USER_CONFIRMED, USER_REJECTED → update DecisionPacket status

The existing test only covers DECISION_BLOCKED → DecisionPacket update. We need to add: compliance DECISION_APPROVED path, user response paths (USER_CONFIRMED, USER_REJECTED), and at least one agent trigger path (MANDATE_CREATED with mocked agent).

DDB entity: `DecisionPacket` (pk: `DecisionPacket#{tenantId}#{dpId}`, sk: `DecisionPacket`). CDC events: `DECISION_PACKET` (on DecisionPacket), `AGENT_INVOCATION` (on AgentInvocation), `WORKFLOW_STATE` (on WorkflowState).

The agent trigger path requires a mock agent Lambda that returns canned responses instead of calling Bedrock. The agent endpoint needs to be overridden via SsmOverrideFixture.

- [ ] **Step 1: Read advisory-ctrl handler and agent integration**

Read these files to understand the exact agent invocation mechanism:
- `services/advisory/advisory-ctrl/src/handlers/event-listener.ts`
- `services/advisory/advisory-ctrl/src/service.stack.ts`
- Check for agent SSM parameter names (the endpoint URL that routes to AgentCore runtime)

Understand how the handler decides between agent invocation vs. compliance callback vs. user response routing.

- [ ] **Step 2: Create mock agent handler**

Create `services/advisory/advisory-ctrl/test/mocks/mock-agent-runtime.ts`:

```typescript
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } };
}

/**
 * Mock agent runtime that returns canned responses.
 * Simulates the LangGraph agent decision lifecycle without real Bedrock calls.
 */
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const body = JSON.parse(event.body ?? '{}');

  // Return a canned agent result based on the input event type
  return json(200, {
    status: 'COMPLETED',
    output: {
      recommendation: 'REBALANCE',
      proposedTrades: [
        { symbol: 'VTI', side: 'BUY', quantity: 5, targetWeightPercent: 60 },
        { symbol: 'BND', side: 'BUY', quantity: 10, targetWeightPercent: 40 },
      ],
      explanation: 'Mock agent recommendation for integration test',
      confidenceScore: 0.85,
      riskAssessment: 'LOW',
    },
  });
}
```

- [ ] **Step 3: Add build-mock target**

Add to `services/advisory/advisory-ctrl/project.json`:

```json
"build-mock": {
  "executor": "nx:run-commands",
  "options": {
    "commands": [
      "mkdir -p services/advisory/advisory-ctrl/test/mocks/dist",
      "npx esbuild services/advisory/advisory-ctrl/test/mocks/mock-agent-runtime.ts --bundle --platform=node --target=node20 --outfile=services/advisory/advisory-ctrl/test/mocks/dist/index.mjs --format=esm",
      "cd services/advisory/advisory-ctrl/test/mocks/dist && zip -j ../mock-agent-runtime.zip index.mjs"
    ],
    "parallel": false
  },
  "outputs": ["services/advisory/advisory-ctrl/test/mocks/mock-agent-runtime.zip"]
}
```

Build:
```bash
pnpm nx build-mock advisory-ctrl
```

- [ ] **Step 4: Rewrite integration test with expanded coverage**

Replace `services/advisory/advisory-ctrl/test/integration/advisory-ctrl.integration.test.ts`:

```typescript
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  DdbSeedFixture,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('advisory-ctrl', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;
  let seeder: DdbSeedFixture;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();
    seeder = new DdbSeedFixture(ctx);

    // Trap all DecisionPacket-related CDC events
    await trap.deploy({
      bus: 'advisory',
      detailType: [
        'DECISION_PACKET',
        'AGENT_INVOCATION',
        'WORKFLOW_STATE',
      ],
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  // ── Compliance Callback Path ────────────────────────────────────────

  describe('compliance callback path', () => {
    it('should update DecisionPacket to BLOCKED on DECISION_BLOCKED', async () => {
      const dpId = `integ-dp-blocked-${Date.now()}`;

      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-ctrl',
        detailType: 'DECISION_BLOCKED',
        detail: {
          decisionId: dpId,
          tenantId: ctx.tenantId,
          reason: 'Integration test block',
          authorityLevel: 'L1',
        },
      });

      const pk = `DecisionPacket#${ctx.tenantId}#${dpId}`;
      const item = await table.waitForItem({
        table: 'advisory-ctrl',
        pk,
        sk: 'DecisionPacket',
        timeoutMs: 60_000,
      });

      expect(item['status']).toBe('BLOCKED');
      expect(item['complianceResult']).toBe('BLOCKED');
      expect(item['blockReason']).toBe('Integration test block');
    }, 120_000);

    it('should update DecisionPacket to APPROVED on DECISION_APPROVED', async () => {
      const dpId = `integ-dp-approved-${Date.now()}`;

      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-ctrl',
        detailType: 'DECISION_APPROVED',
        detail: {
          decisionId: dpId,
          tenantId: ctx.tenantId,
          authorityLevel: 'L1',
        },
      });

      const pk = `DecisionPacket#${ctx.tenantId}#${dpId}`;
      const item = await table.waitForItem({
        table: 'advisory-ctrl',
        pk,
        sk: 'DecisionPacket',
        timeoutMs: 60_000,
      });

      expect(item['status']).toBe('APPROVED');
      expect(item['complianceResult']).toBe('APPROVED');
    }, 120_000);
  });

  // ── User Response Path ──────────────────────────────────────────────

  describe('user response path', () => {
    it('should update DecisionPacket to CONFIRMED on USER_CONFIRMED', async () => {
      const dpId = `integ-dp-confirmed-${Date.now()}`;

      // Pre-seed DecisionPacket in PENDING_USER state
      await seeder.seed({
        table: 'advisory-ctrl',
        items: [{
          pk: `DecisionPacket#${ctx.tenantId}#${dpId}`,
          sk: 'DecisionPacket',
          __typename: 'DecisionPacket',
          tenantId: ctx.tenantId,
          decisionId: dpId,
          status: 'PENDING_USER',
          createdAt: new Date().toISOString(),
        }],
      });

      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-ctrl',
        detailType: 'USER_CONFIRMED',
        detail: {
          decisionId: dpId,
          tenantId: ctx.tenantId,
        },
      });

      const pk = `DecisionPacket#${ctx.tenantId}#${dpId}`;
      const item = await table.waitForItem({
        table: 'advisory-ctrl',
        pk,
        sk: 'DecisionPacket',
        timeoutMs: 60_000,
      });

      expect(item['status']).toBe('CONFIRMED');
    }, 120_000);

    it('should update DecisionPacket to REJECTED on USER_REJECTED', async () => {
      const dpId = `integ-dp-rejected-${Date.now()}`;

      await seeder.seed({
        table: 'advisory-ctrl',
        items: [{
          pk: `DecisionPacket#${ctx.tenantId}#${dpId}`,
          sk: 'DecisionPacket',
          __typename: 'DecisionPacket',
          tenantId: ctx.tenantId,
          decisionId: dpId,
          status: 'PENDING_USER',
          createdAt: new Date().toISOString(),
        }],
      });

      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-ctrl',
        detailType: 'USER_REJECTED',
        detail: {
          decisionId: dpId,
          tenantId: ctx.tenantId,
          reason: 'Integration test rejection',
        },
      });

      const pk = `DecisionPacket#${ctx.tenantId}#${dpId}`;
      const item = await table.waitForItem({
        table: 'advisory-ctrl',
        pk,
        sk: 'DecisionPacket',
        timeoutMs: 60_000,
      });

      expect(item['status']).toBe('REJECTED');
    }, 120_000);
  });
});
```

**Note:** The agent trigger path (MANDATE_CREATED → agent invocation) is deferred from this test because it requires understanding the exact SSM parameter for the agent endpoint and the invocation protocol. The subagent implementing this task should read the handler code to determine if MockApiFixture + SsmOverrideFixture can redirect agent calls, and add an agent trigger test if feasible. If the agent is invoked via Bedrock AgentCore (not via HTTP), skip the agent test and document why.

- [ ] **Step 5: Run integration tests**

```bash
pnpm nx build-mock advisory-ctrl && pnpm nx test-integration advisory-ctrl
```
Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add services/advisory/advisory-ctrl/
git commit -m "feat(advisory-ctrl): expand integration tests — compliance + user response paths"
```

---

### Task 2: execution-ctrl — Expand Integration Tests

**Files:**
- Rewrite: `services/execution/execution-ctrl/test/integration/execution-ctrl.integration.test.ts`

**Context:** execution-ctrl subscribes to: DECISION_APPROVED, USER_CONFIRMED, CIRCUIT_BREAKER_TRIGGERED, CIRCUIT_BREAKER_RESET, ACCOUNT_CLOSURE_REQUESTED. DDB entities: `Order` (pk: `Order#{tenantId}#{orderId}`, sk: `Order`) and `StagedOrder` (pk: `StagedOrder#{tenantId}#...`). CDC events: ORDER_SUBMITTED (default), ORDER_STAGED (status=STAGED), ORDER_REJECTED (status=REJECTED), STAGED_ORDER.

Existing test covers DECISION_APPROVED → ORDER_SUBMITTED/STAGED/REJECTED. Add: USER_CONFIRMED, CIRCUIT_BREAKER_TRIGGERED/RESET.

- [ ] **Step 1: Read execution-ctrl handler to understand all event paths**

Read `services/execution/execution-ctrl/src/handlers/event-listener.ts` to understand how each event type is routed (processDecisionApproved, processUserConfirmed, processCircuitBreaker, processAccountClosure).

- [ ] **Step 2: Rewrite integration test**

Replace `services/execution/execution-ctrl/test/integration/execution-ctrl.integration.test.ts`:

```typescript
import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  DdbSeedFixture,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('execution-ctrl', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;
  let seeder: DdbSeedFixture;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();
    seeder = new DdbSeedFixture(ctx);

    await trap.deploy({
      bus: 'execution',
      detailType: ['ORDER_SUBMITTED', 'ORDER_STAGED', 'ORDER_REJECTED', 'STAGED_ORDER'],
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('should create Order on DECISION_APPROVED and emit CDC event', async () => {
    await eb.putEvent({
      bus: 'execution',
      targetService: 'execution-ctrl',
      detailType: 'DECISION_APPROVED',
      detail: {
        decisionPacketId: `integ-decision-${Date.now()}`,
        proposedTrades: [
          { symbol: 'AAPL', assetClass: 'EQUITY', side: 'BUY', quantityOrAmountCents: 1000, targetWeightPercent: 10 },
        ],
      },
    });

    const event = await trap.waitForEvent({ timeoutMs: 90_000 });
    expect(['ORDER_SUBMITTED', 'ORDER_STAGED', 'ORDER_REJECTED']).toContain(event.detailType);
  }, 120_000);

  it('should process USER_CONFIRMED and create Order', async () => {
    const dpId = `integ-dp-confirmed-${Date.now()}`;

    await eb.putEvent({
      bus: 'execution',
      targetService: 'execution-ctrl',
      detailType: 'USER_CONFIRMED',
      detail: {
        decisionPacketId: dpId,
        tenantId: ctx.tenantId,
        proposedTrades: [
          { symbol: 'VTI', assetClass: 'EQUITY', side: 'BUY', quantityOrAmountCents: 500, targetWeightPercent: 5 },
        ],
      },
    });

    const event = await trap.waitForEvent({ timeoutMs: 90_000 });
    expect(['ORDER_SUBMITTED', 'ORDER_STAGED', 'ORDER_REJECTED']).toContain(event.detailType);
  }, 120_000);

  it('should write circuit breaker state on CIRCUIT_BREAKER_TRIGGERED', async () => {
    await eb.putEvent({
      bus: 'execution',
      targetService: 'execution-ctrl',
      detailType: 'CIRCUIT_BREAKER_TRIGGERED',
      detail: {
        reason: 'Integration test circuit breaker',
        triggeredBy: 'test',
      },
    });

    // Verify DDB write — check for a record indicating circuit breaker state
    // The exact pk/sk depends on the handler implementation; read event-listener.ts
    // to determine. Likely: pk: CircuitBreaker#{tenantId}, sk: CircuitBreaker
    // Adjust pk/sk after reading the handler.
    const item = await table.waitForItem({
      table: 'execution-ctrl',
      pk: `T#${ctx.tenantId}`,
      timeoutMs: 60_000,
    });

    // Verify item was written (exact field assertions depend on handler)
    expect(item['tenantId']).toBe(ctx.tenantId);
  }, 120_000);
});
```

**Note:** The subagent implementing this task MUST read `services/execution/execution-ctrl/src/handlers/event-listener.ts` first to verify the exact DDB PK/SK patterns for CIRCUIT_BREAKER_TRIGGERED and USER_CONFIRMED. The test code above uses placeholder PK patterns that need to be updated based on the actual handler logic.

- [ ] **Step 3: Run integration tests**

```bash
pnpm nx test-integration execution-ctrl
```
Expected: 3 tests pass.

- [ ] **Step 4: Commit**

```bash
git add services/execution/execution-ctrl/test/integration/
git commit -m "feat(execution-ctrl): expand integration tests — user confirmed + circuit breaker"
```

---

### Task 3: compliance-ctrl — Expand Integration Tests

**Files:**
- Rewrite: `services/advisory/compliance-ctrl/test/integration/compliance-ctrl.integration.test.ts`

**Context:** compliance-ctrl subscribes to: DECISION_PACKET_CREATED, DECISION_PACKET_UPDATED, MANDATE_CREATED, MANDATE_UPDATED, OPERATING_MODE_CHANGED. DDB entity: `ComplianceCheck` (pk: `ComplianceCheck#{tenantId}#{ccId}`, sk varies). CDC: field dispatch on `result` — APPROVED → DECISION_APPROVED, BLOCKED → DECISION_BLOCKED.

Existing test covers DECISION_PACKET_CREATED → DECISION_APPROVED/BLOCKED. Add: DECISION_PACKET_UPDATED (re-evaluation), MANDATE_CREATED (rules loading).

- [ ] **Step 1: Read compliance-ctrl handler**

Read `services/advisory/compliance-ctrl/src/handlers/event-listener.ts` to understand how DECISION_PACKET_UPDATED and MANDATE_CREATED are handled. Identify DDB PK/SK patterns for each path.

- [ ] **Step 2: Rewrite integration test**

Replace `services/advisory/compliance-ctrl/test/integration/compliance-ctrl.integration.test.ts`:

```typescript
import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('compliance-ctrl', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();

    await trap.deploy({
      bus: 'advisory',
      detailType: ['DECISION_APPROVED', 'DECISION_BLOCKED'],
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('should emit DECISION_APPROVED or DECISION_BLOCKED on DECISION_PACKET_CREATED', async () => {
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: 'DECISION_PACKET_CREATED',
      detail: {
        decisionId: `test-decision-${Date.now()}`,
        proposedTrades: [
          { symbol: 'AAPL', side: 'BUY', quantity: 10, price: 150.0 },
        ],
        portfolioValue: 50000,
        riskScore: 5,
        currentPositions: [
          { symbol: 'AAPL', quantity: 5, value: 750.0 },
        ],
      },
    });

    const event = await trap.waitForEvent({ timeoutMs: 90_000 });
    expect(['DECISION_APPROVED', 'DECISION_BLOCKED']).toContain(event.detailType);
  }, 120_000);

  it('should re-evaluate on DECISION_PACKET_UPDATED', async () => {
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: 'DECISION_PACKET_UPDATED',
      detail: {
        decisionId: `test-decision-update-${Date.now()}`,
        proposedTrades: [
          { symbol: 'BND', side: 'BUY', quantity: 20, price: 75.0 },
        ],
        portfolioValue: 50000,
        riskScore: 3,
        currentPositions: [],
      },
    });

    const event = await trap.waitForEvent({ timeoutMs: 90_000 });
    expect(['DECISION_APPROVED', 'DECISION_BLOCKED']).toContain(event.detailType);
  }, 120_000);

  it('should write compliance rules on MANDATE_CREATED', async () => {
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: 'MANDATE_CREATED',
      detail: {
        mandateId: `integ-mandate-${Date.now()}`,
        tenantId: ctx.tenantId,
        riskTolerance: 'MODERATE',
        investmentHorizon: 'LONG_TERM',
      },
    });

    // Verify DDB write — compliance rules or mandate record
    // Exact pk/sk depends on handler; read event-listener.ts to determine
    const item = await table.waitForItem({
      table: 'compliance-ctrl',
      pk: `T#${ctx.tenantId}`,
      timeoutMs: 60_000,
    });

    expect(item['tenantId']).toBe(ctx.tenantId);
  }, 120_000);
});
```

**Note:** Subagent must read the handler to verify DDB PK/SK for MANDATE_CREATED path and adjust accordingly.

- [ ] **Step 3: Run integration tests**

```bash
pnpm nx test-integration compliance-ctrl
```

- [ ] **Step 4: Commit**

```bash
git add services/advisory/compliance-ctrl/test/integration/
git commit -m "feat(compliance-ctrl): expand integration tests — packet update + mandate"
```

---

### Task 4: broker-sim-adpt — Expand Integration Tests

**Files:**
- Rewrite: `services/execution/broker-sim-adpt/test/integration/broker-sim-adpt.integration.test.ts`

**Context:** broker-sim-adpt subscribes to: SIM_ORDER_REQUESTED, SIM_DEPOSIT_INITIATED, SIM_WITHDRAWAL_REQUESTED. DDB entities: `VirtualTrade` (pk: `VirtualLedger#{tenantId}#{userId}`, sk: `Trade#{orderId}`), `DepositDetected` (pk/sk varies), `WithdrawalCompleted` (pk/sk varies). CDC: SIM_ORDER_FILLED, SIM_ORDER_REJECTED, SIM_DEPOSIT_COMPLETED, SIM_WITHDRAWAL_COMPLETED.

Existing test covers SIM_ORDER_REQUESTED → VirtualTrade + SIM_ORDER_FILLED. Add: SIM_DEPOSIT_INITIATED, SIM_WITHDRAWAL_REQUESTED.

- [ ] **Step 1: Read broker-sim-adpt handler for deposit/withdrawal paths**

Read `services/execution/broker-sim-adpt/src/handlers/event-listener.ts` to understand DDB PK/SK for deposits and withdrawals.

- [ ] **Step 2: Rewrite integration test**

Replace `services/execution/broker-sim-adpt/test/integration/broker-sim-adpt.integration.test.ts`:

```typescript
import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('broker-sim-adpt', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();

    await trap.deploy({
      bus: 'execution',
      detailType: [
        'SIM_ORDER_FILLED',
        'SIM_ORDER_REJECTED',
        'SIM_DEPOSIT_COMPLETED',
        'SIM_WITHDRAWAL_COMPLETED',
      ],
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  // ── Order Flow ──────────────────────────────────────────────────────

  it('should fill order and emit SIM_ORDER_FILLED', async () => {
    const orderId = `test-order-fill-${Date.now()}`;
    const pk = `VirtualLedger#${ctx.tenantId}#${ctx.userId}`;

    await eb.putEvent({
      bus: 'execution',
      targetService: 'broker-sim-adpt',
      detailType: 'SIM_ORDER_REQUESTED',
      detail: {
        orderId,
        userId: ctx.userId,
        symbol: 'VTI',
        side: 'BUY',
        quantity: 1,
      },
    });

    const item = await table.waitForItem({
      table: 'broker-sim-adpt',
      pk,
      sk: `Trade#${orderId}`,
      timeoutMs: 60_000,
    });
    expect(item['__typename']).toBe('VirtualTrade');
    expect(item['symbol']).toBe('VTI');

    const event = await trap.waitForEvent({ detailType: 'SIM_ORDER_FILLED', timeoutMs: 30_000 });
    expect(event.detailType).toBe('SIM_ORDER_FILLED');
  }, 120_000);

  // ── Deposit Flow ────────────────────────────────────────────────────

  it('should process deposit and emit SIM_DEPOSIT_COMPLETED', async () => {
    const depositId = `test-deposit-${Date.now()}`;

    await eb.putEvent({
      bus: 'execution',
      targetService: 'broker-sim-adpt',
      detailType: 'SIM_DEPOSIT_INITIATED',
      detail: {
        depositId,
        userId: ctx.userId,
        amountCents: 100_000,
        currency: 'USD',
      },
    });

    // Verify CDC event — proves deposit was processed and written to DDB
    const event = await trap.waitForEvent({ detailType: 'SIM_DEPOSIT_COMPLETED', timeoutMs: 60_000 });
    expect(event.detailType).toBe('SIM_DEPOSIT_COMPLETED');
    expect(event.detail.context.tenantId).toBe(ctx.tenantId);
  }, 120_000);

  // ── Withdrawal Flow ─────────────────────────────────────────────────

  it('should process withdrawal and emit SIM_WITHDRAWAL_COMPLETED', async () => {
    const withdrawalId = `test-withdrawal-${Date.now()}`;

    await eb.putEvent({
      bus: 'execution',
      targetService: 'broker-sim-adpt',
      detailType: 'SIM_WITHDRAWAL_REQUESTED',
      detail: {
        withdrawalId,
        userId: ctx.userId,
        amountCents: 50_000,
        currency: 'USD',
      },
    });

    const event = await trap.waitForEvent({ detailType: 'SIM_WITHDRAWAL_COMPLETED', timeoutMs: 60_000 });
    expect(event.detailType).toBe('SIM_WITHDRAWAL_COMPLETED');
    expect(event.detail.context.tenantId).toBe(ctx.tenantId);
  }, 120_000);
});
```

**Note:** Subagent must read the handler to verify exact detail field names for deposits/withdrawals (depositId vs transferId, amountCents vs amount, etc.). Adjust the test detail payloads accordingly.

- [ ] **Step 3: Run integration tests**

```bash
pnpm nx test-integration broker-sim-adpt
```

- [ ] **Step 4: Commit**

```bash
git add services/execution/broker-sim-adpt/test/integration/
git commit -m "feat(broker-sim-adpt): expand integration tests — deposit + withdrawal"
```

---

### Task 5: advisory-bff — Expand Integration Tests (Event Materializations + AppSync)

**Files:**
- Rewrite: `services/advisory/advisory-bff/test/integration/advisory-bff.integration.test.ts`

**Context:** advisory-bff has two test paths:
1. **Event materializations** (5 inbound events): DECISION_PACKET_CREATED, DECISION_PACKET_UPDATED, DECISION_APPROVED, DECISION_BLOCKED, USER_CONFIRMATION_REQUESTED → write DecisionReadModel to DDB
2. **AppSync mutations**: confirmDecision, rejectDecision → write UserConfirmation/UserRejection to DDB → CDC events USER_CONFIRMED/USER_REJECTED

Existing test covers DECISION_PACKET_CREATED → DecisionSummary DDB write. Add: other event materializations + AppSync mutations.

DDB: `DecisionSummary` / `DecisionReadModel` (pk: `T#{tenantId}`, sk: `DecisionSummary#{eventId}` for record(), or more specific sk for updates). CDC: USER_CONFIRMED, USER_REJECTED.

- [ ] **Step 1: Read advisory-bff handler, transforms, and AppSync schema**

Read:
- `services/advisory/advisory-bff/src/handlers/event-listener.ts` — understand transform routing
- `services/advisory/advisory-bff/src/schema.graphql` — find exact mutation signatures (confirmDecision, rejectDecision)
- `services/advisory/advisory-bff/src/resolvers/` — understand how mutations write to DDB

- [ ] **Step 2: Rewrite integration test**

Replace `services/advisory/advisory-bff/test/integration/advisory-bff.integration.test.ts`:

```typescript
import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  DdbSeedFixture,
  CognitoFixture,
  AppSyncClient,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('advisory-bff', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;
  let seeder: DdbSeedFixture;
  let appsync: AppSyncClient;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();
    seeder = new DdbSeedFixture(ctx);

    // Set up Cognito + AppSync for mutation tests
    const cognito = new CognitoFixture(ctx);
    const tokens = await cognito.setup();
    appsync = new AppSyncClient(ctx, tokens, 'advisory-bff');

    await trap.deploy({
      bus: 'advisory',
      detailType: ['USER_CONFIRMED', 'USER_REJECTED', 'DECISION_READ_MODEL'],
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  // ── Event Materializations ──────────────────────────────────────────

  describe('event materializations', () => {
    it('should materialize DecisionSummary on DECISION_PACKET_CREATED', async () => {
      const decisionId = `integ-decision-${Date.now()}`;

      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DECISION_PACKET_CREATED',
        detail: {
          tenantId: ctx.tenantId,
          decisionId,
          trigger: 'REBALANCE',
          proposedTrades: [{ symbol: 'AAPL', action: 'BUY', quantity: 10 }],
          explanation: 'Integration test decision',
          confirmationRequired: true,
        },
      });

      const item = await table.waitForItem({
        table: 'advisory-bff',
        pk: `T#${ctx.tenantId}`,
        timeoutMs: 60_000,
      });

      expect(item['__typename']).toBe('DecisionSummary');
      expect(item['trigger']).toBe('REBALANCE');
    }, 120_000);

    it('should materialize status change on DECISION_APPROVED', async () => {
      const decisionId = `integ-decision-approved-${Date.now()}`;

      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DECISION_APPROVED',
        detail: {
          tenantId: ctx.tenantId,
          decisionId,
          authorityLevel: 'L1',
        },
      });

      const item = await table.waitForItem({
        table: 'advisory-bff',
        pk: `T#${ctx.tenantId}`,
        timeoutMs: 60_000,
      });

      expect(item['tenantId']).toBe(ctx.tenantId);
    }, 120_000);
  });

  // ── AppSync Mutations ───────────────────────────────────────────────

  describe('AppSync mutations', () => {
    it('should confirm decision via confirmDecision mutation', async () => {
      const decisionId = `integ-confirm-${Date.now()}`;

      // Pre-seed a DecisionReadModel so the resolver can find it
      await seeder.seed({
        table: 'advisory-bff',
        items: [{
          pk: `T#${ctx.tenantId}`,
          sk: `Decision#${decisionId}`,
          __typename: 'DecisionReadModel',
          tenantId: ctx.tenantId,
          decisionId,
          status: 'PENDING_USER',
          trigger: 'REBALANCE',
          createdAt: new Date().toISOString(),
        }],
      });

      // Read the actual GraphQL schema to get the exact mutation signature.
      // Expected: confirmDecision(decisionId: ID!): DecisionConfirmation
      // Adjust the mutation string based on the actual schema.
      const result = await appsync.mutate<{ confirmDecision: { status: string } }>(`
        mutation ConfirmDecision($decisionId: ID!) {
          confirmDecision(decisionId: $decisionId) { status }
        }
      `, { decisionId });

      expect(result.confirmDecision.status).toBeDefined();

      // Verify CDC event
      const event = await trap.waitForEvent({ detailType: 'USER_CONFIRMED', timeoutMs: 60_000 });
      expect(event.detail.context.tenantId).toBe(ctx.tenantId);
    }, 120_000);

    it('should reject decision via rejectDecision mutation', async () => {
      const decisionId = `integ-reject-${Date.now()}`;

      await seeder.seed({
        table: 'advisory-bff',
        items: [{
          pk: `T#${ctx.tenantId}`,
          sk: `Decision#${decisionId}`,
          __typename: 'DecisionReadModel',
          tenantId: ctx.tenantId,
          decisionId,
          status: 'PENDING_USER',
          trigger: 'REBALANCE',
          createdAt: new Date().toISOString(),
        }],
      });

      const result = await appsync.mutate<{ rejectDecision: { status: string } }>(`
        mutation RejectDecision($decisionId: ID!, $reason: String) {
          rejectDecision(decisionId: $decisionId, reason: $reason) { status }
        }
      `, { decisionId, reason: 'Integration test rejection' });

      expect(result.rejectDecision.status).toBeDefined();

      const event = await trap.waitForEvent({ detailType: 'USER_REJECTED', timeoutMs: 60_000 });
      expect(event.detail.context.tenantId).toBe(ctx.tenantId);
    }, 120_000);
  });
});
```

**Note:** The subagent MUST read `services/advisory/advisory-bff/src/schema.graphql` to verify exact mutation signatures (parameter names, return types). Also read the JS resolvers to understand how the mutation writes to DDB and what DDB PK/SK pattern the seeded record needs.

- [ ] **Step 3: Run integration tests**

```bash
pnpm nx test-integration advisory-bff
```

- [ ] **Step 4: Commit**

```bash
git add services/advisory/advisory-bff/test/integration/
git commit -m "feat(advisory-bff): expand integration tests — AppSync mutations + event materializations"
```

---

### Task 6: ledger-ctrl — Expand Integration Tests (Full Event Coverage + CDC Chain)

**Files:**
- Rewrite: `services/ledger/ledger-ctrl/test/integration/ledger-ctrl.integration.test.ts`

**Context:** ledger-ctrl subscribes to: ORDER_FILLED, ORDER_PARTIALLY_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED, WITHDRAWAL_COMPLETED, CORPORATE_ACTION_APPLIED, DECISION_PACKET_CREATED. Triple handler pattern: event-listener (LedgerEntry write) → reducer (DDB Stream → AccountSnapshot) → event-publisher (CDC → BALANCE_UPDATED, PORTFOLIO_UPDATED, LEDGER_ENTRY_RECORDED).

Existing tests: ORDER_FILLED → LedgerEntry write (smoke) + ORDER_FILLED → BALANCE_UPDATED via full CDC chain. Add: other event types (deposits, withdrawals, partial fills, rejections).

DDB: `LedgerEntry` (pk: `Account#{tenantId}#actual`, sk: varies), `AccountSnapshot` (pk: `Account#{tenantId}#actual`, sk: `Snapshot#latest`). CDC: BALANCE_UPDATED, PORTFOLIO_UPDATED, LEDGER_ENTRY_RECORDED.

- [ ] **Step 1: Read ledger-ctrl handler to understand all event type routing**

Read `services/ledger/ledger-ctrl/src/handlers/event-listener.ts` to see how each event type creates different LedgerEntry types (TRADE, CASH_IN, CASH_OUT, etc.).

- [ ] **Step 2: Rewrite integration test**

Replace `services/ledger/ledger-ctrl/test/integration/ledger-ctrl.integration.test.ts`:

```typescript
import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  AccountSeedingFixture,
  TableAssertions,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('ledger-ctrl', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;
  let seeder: AccountSeedingFixture;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();
    seeder = new AccountSeedingFixture(ctx);

    // Seed initial account state for Reducer
    await seeder.seed('ledger-ctrl');

    await trap.deploy({
      bus: 'ledger',
      detailType: ['BALANCE_UPDATED', 'PORTFOLIO_UPDATED', 'LEDGER_ENTRY_RECORDED'],
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  // ── ORDER_FILLED ────────────────────────────────────────────────────

  it('should record LedgerEntry and emit BALANCE_UPDATED on ORDER_FILLED', async () => {
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'ORDER_FILLED',
      detail: {
        orderId: `integ-fill-${Date.now()}`,
        symbol: 'AAPL',
        side: 'BUY',
        quantity: 10,
        fillPrice: 150.0,
        filledAt: new Date().toISOString(),
        executionMode: 'paper',
      },
    });

    // Verify LedgerEntry DDB write
    const item = await table.waitForItem({
      table: 'ledger-ctrl',
      pk: `Account#${ctx.tenantId}#actual`,
      timeoutMs: 60_000,
    });
    expect(item['__typename']).toBe('LedgerEntry');
    expect(item['eventType']).toBe('ORDER_FILLED');

    // Verify CDC chain: LedgerEntry → Reducer → BALANCE_UPDATED
    const event = await trap.waitForEvent({ detailType: 'BALANCE_UPDATED', timeoutMs: 90_000 });
    expect(event.detail.context.tenantId).toBe(ctx.tenantId);
  }, 120_000);

  // ── DEPOSIT_DETECTED ────────────────────────────────────────────────

  it('should record deposit entry on DEPOSIT_DETECTED', async () => {
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'DEPOSIT_DETECTED',
      detail: {
        depositId: `integ-deposit-${Date.now()}`,
        amountCents: 100_000,
        currency: 'USD',
        detectedAt: new Date().toISOString(),
      },
    });

    const event = await trap.waitForEvent({ detailType: 'BALANCE_UPDATED', timeoutMs: 90_000 });
    expect(event.detailType).toBe('BALANCE_UPDATED');
  }, 120_000);

  // ── WITHDRAWAL_COMPLETED ────────────────────────────────────────────

  it('should record withdrawal entry on WITHDRAWAL_COMPLETED', async () => {
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'WITHDRAWAL_COMPLETED',
      detail: {
        withdrawalId: `integ-withdrawal-${Date.now()}`,
        amountCents: 50_000,
        currency: 'USD',
        completedAt: new Date().toISOString(),
      },
    });

    const event = await trap.waitForEvent({ detailType: 'BALANCE_UPDATED', timeoutMs: 90_000 });
    expect(event.detailType).toBe('BALANCE_UPDATED');
  }, 120_000);

  // ── ORDER_PARTIALLY_FILLED ──────────────────────────────────────────

  it('should record partial fill entry on ORDER_PARTIALLY_FILLED', async () => {
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'ORDER_PARTIALLY_FILLED',
      detail: {
        orderId: `integ-partial-${Date.now()}`,
        symbol: 'VTI',
        side: 'BUY',
        quantity: 5,
        filledQuantity: 3,
        fillPrice: 200.0,
        filledAt: new Date().toISOString(),
        executionMode: 'paper',
      },
    });

    const event = await trap.waitForEvent({ timeoutMs: 90_000 });
    expect(['BALANCE_UPDATED', 'PORTFOLIO_UPDATED', 'LEDGER_ENTRY_RECORDED']).toContain(event.detailType);
  }, 120_000);

  // ── ORDER_REJECTED ──────────────────────────────────────────────────

  it('should handle ORDER_REJECTED', async () => {
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'ORDER_REJECTED',
      detail: {
        orderId: `integ-rejected-${Date.now()}`,
        symbol: 'AAPL',
        side: 'BUY',
        quantity: 100,
        rejectionReason: 'Insufficient funds',
        rejectedAt: new Date().toISOString(),
      },
    });

    // ORDER_REJECTED may or may not produce a LedgerEntry (depends on handler logic)
    // Verify via CDC event or DDB write — subagent should check handler
    const event = await trap.waitForEvent({ timeoutMs: 90_000 });
    expect(event.detailType).toBeDefined();
  }, 120_000);
});
```

**Note:** The subagent implementing this task MUST read `services/ledger/ledger-ctrl/src/handlers/event-listener.ts` to verify the exact detail field names for each event type and the LedgerEntry subtypes produced (TRADE, CASH_IN, CASH_OUT, REVERSAL, etc.).

- [ ] **Step 3: Run integration tests**

```bash
pnpm nx test-integration ledger-ctrl
```

- [ ] **Step 4: Commit**

```bash
git add services/ledger/ledger-ctrl/test/integration/
git commit -m "feat(ledger-ctrl): expand integration tests — deposits, withdrawals, partial fills"
```

---

### Task 7: broker-ctrl — Expand Integration Tests (Order Lifecycle)

**Files:**
- Rewrite: `services/execution/broker-ctrl/test/integration/broker-ctrl.integration.test.ts`

**Context:** broker-ctrl has 4 Ingress handlers:
1. **mode-listener**: EXECUTION_MODE_CHANGED → DDB ExecutionMode write (already tested)
2. **callback-resolver**: SIM_ORDER_FILLED, SIM_ORDER_REJECTED, ALPACA_ORDER_* → resolves SF task tokens
3. **deposit-withdrawal-router**: DEPOSIT_INITIATED, WITHDRAWAL_REQUESTED → routes to correct adapter
4. **deposit-withdrawal-normalizer**: SIM_DEPOSIT_COMPLETED, SIM_WITHDRAWAL_COMPLETED, ALPACA_TRANSFER_* → normalizes to NormalizedEvent for CDC

DDB entities: `BrokerOrder` (pk: `BrokerOrder#{tenantId}#{orderId}`, sk: `BrokerOrder`), `ExecutionMode`, `NormalizedEvent`. CDC: passthrough on NormalizedEvent sk field.

Existing test covers EXECUTION_MODE_CHANGED only. Add: deposit/withdrawal routing and normalization. Full SF order lifecycle tests are complex (need to trigger ORDER_SUBMITTED → SF start → route → adapter callback) — focus on the non-SF paths first.

- [ ] **Step 1: Read broker-ctrl handlers**

Read:
- `services/execution/broker-ctrl/src/handlers/deposit-withdrawal-router.ts`
- `services/execution/broker-ctrl/src/handlers/deposit-withdrawal-normalizer.ts`
- `services/execution/broker-ctrl/src/handlers/callback-resolver.ts`

Understand the DDB write patterns for each.

- [ ] **Step 2: Rewrite integration test**

Replace `services/execution/broker-ctrl/test/integration/broker-ctrl.integration.test.ts`:

```typescript
import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('broker-ctrl', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();

    await trap.deploy({
      bus: 'execution',
      detailType: [
        'DEPOSIT_DETECTED',
        'WITHDRAWAL_COMPLETED',
        'TRANSFER_FAILED',
        'ORDER_FILLED',
        'ORDER_REJECTED',
      ],
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  // ── Mode Listener ───────────────────────────────────────────────────

  it('should write ExecutionMode on EXECUTION_MODE_CHANGED', async () => {
    await eb.putEvent({
      bus: 'execution',
      targetService: 'broker-ctrl',
      detailType: 'EXECUTION_MODE_CHANGED',
      detail: { mode: 'simulation' },
    });

    const item = await table.waitForItem({
      table: 'broker-ctrl',
      pk: `ExecutionMode#${ctx.tenantId}`,
      sk: 'ExecutionMode',
      timeoutMs: 60_000,
    });

    expect(item['__typename']).toBe('ExecutionMode');
    expect(item['mode']).toBe('simulation');
  }, 120_000);

  // ── Deposit/Withdrawal Normalizer ───────────────────────────────────

  it('should normalize SIM_DEPOSIT_COMPLETED to DEPOSIT_DETECTED', async () => {
    await eb.putEvent({
      bus: 'execution',
      targetService: 'broker-ctrl',
      detailType: 'SIM_DEPOSIT_COMPLETED',
      detail: {
        depositId: `integ-sim-deposit-${Date.now()}`,
        amountCents: 100_000,
        completedAt: new Date().toISOString(),
      },
    });

    // Normalizer writes NormalizedEvent to DDB → CDC emits DEPOSIT_DETECTED
    const event = await trap.waitForEvent({ detailType: 'DEPOSIT_DETECTED', timeoutMs: 60_000 });
    expect(event.detailType).toBe('DEPOSIT_DETECTED');
    expect(event.detail.context.tenantId).toBe(ctx.tenantId);
  }, 120_000);

  it('should normalize SIM_WITHDRAWAL_COMPLETED to WITHDRAWAL_COMPLETED', async () => {
    await eb.putEvent({
      bus: 'execution',
      targetService: 'broker-ctrl',
      detailType: 'SIM_WITHDRAWAL_COMPLETED',
      detail: {
        withdrawalId: `integ-sim-withdrawal-${Date.now()}`,
        amountCents: 50_000,
        completedAt: new Date().toISOString(),
      },
    });

    const event = await trap.waitForEvent({ detailType: 'WITHDRAWAL_COMPLETED', timeoutMs: 60_000 });
    expect(event.detailType).toBe('WITHDRAWAL_COMPLETED');
  }, 120_000);

  // ── Deposit/Withdrawal Router ───────────────────────────────────────

  it('should route DEPOSIT_INITIATED to the correct adapter bus', async () => {
    // Pre-seed ExecutionMode so the router knows which adapter to target
    // (simulation → SIM_DEPOSIT_INITIATED, live → ALPACA_TRANSFER_REQUESTED)
    await eb.putEvent({
      bus: 'execution',
      targetService: 'broker-ctrl',
      detailType: 'EXECUTION_MODE_CHANGED',
      detail: { mode: 'simulation' },
    });

    // Wait for mode to be written
    await table.waitForItem({
      table: 'broker-ctrl',
      pk: `ExecutionMode#${ctx.tenantId}`,
      sk: 'ExecutionMode',
      timeoutMs: 30_000,
    });

    // Now route a deposit
    await eb.putEvent({
      bus: 'execution',
      targetService: 'broker-ctrl',
      detailType: 'DEPOSIT_INITIATED',
      detail: {
        depositId: `integ-route-deposit-${Date.now()}`,
        amountCents: 100_000,
        currency: 'USD',
      },
    });

    // The router writes a DDB record tracking the routed deposit
    // Exact pk/sk depends on handler — subagent must verify
    const item = await table.waitForItem({
      table: 'broker-ctrl',
      pk: `T#${ctx.tenantId}`,
      timeoutMs: 60_000,
    });

    expect(item['tenantId']).toBe(ctx.tenantId);
  }, 120_000);
});
```

**Note:** The subagent MUST read all broker-ctrl handlers to verify exact DDB PK/SK patterns and event detail field names. The deposit-withdrawal-normalizer's NormalizedEvent entity has `sk` field that determines the CDC event type — verify this mapping.

- [ ] **Step 3: Run integration tests**

```bash
pnpm nx test-integration broker-ctrl
```

- [ ] **Step 4: Commit**

```bash
git add services/execution/broker-ctrl/test/integration/
git commit -m "feat(broker-ctrl): expand integration tests — normalizer + router paths"
```

---

### Task 8: decision-workflow-ctrl — Expand Integration Tests

**Files:**
- Create: `services/advisory/decision-workflow-ctrl/test/mocks/mock-agent-responses.ts`
- Modify: `services/advisory/decision-workflow-ctrl/project.json` — add `build-mock` target
- Rewrite: `services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts`

**Context:** decision-workflow-ctrl has dual Ingress:
1. **TriggerIngress**: MANDATE_CREATED, GOAL_CREATED, etc. → write WorkflowTrigger to DDB → CDC → SF starts
2. **CallbackIngress**: INVESTOR_PROFILE_COMPLETED, MARKET_ANALYSIS_COMPLETED, PORTFOLIO_COMPLETED, NARRATIVE_COMPLETED, DECISION_APPROVED, DECISION_BLOCKED, USER_CONFIRMED, USER_REJECTED → resume SF via SendTaskSuccess

The DecisionStateMachine orchestrates a multi-stage workflow:
1. SF starts → dispatches parallel agent invocations (InvestorProfile + MarketIntelligence)
2. Callbacks resume SF → dispatches PortfolioEngine → callback → dispatches AdvisoryNarrative → callback
3. assemble-packet Lambda runs → DecisionPacket (ASSEMBLED) → DECISION_PACKET_CREATED CDC
4. Compliance callback (DECISION_APPROVED/BLOCKED) → SF resumes → User callback

Existing test covers MANDATE_CREATED → WorkflowTrigger DDB write only (no SF execution).

For full SF testing, we'd need to send the trigger event, wait for agent dispatch events, send callback events for each agent stage, and follow the entire lifecycle. This is complex (~120-180s per test). Instead, we add targeted tests for the callback paths.

**IMPORTANT:** This task depends on the mock agent pattern established in Task 1. The subagent should reference the `mock-agent-runtime.ts` pattern from Task 1.

- [ ] **Step 1: Read decision-workflow-ctrl handlers and SF definition**

Read:
- `services/advisory/decision-workflow-ctrl/src/handlers/event-listener.ts` (TriggerIngress)
- `services/advisory/decision-workflow-ctrl/src/handlers/sfn-callback.ts` (CallbackIngress)
- `services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts`
- `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts`

Understand how callbacks resume the SF and what DDB writes happen at each stage.

- [ ] **Step 2: Create mock agent responses handler**

Create `services/advisory/decision-workflow-ctrl/test/mocks/mock-agent-responses.ts`:

```typescript
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } };
}

/**
 * Mock agent that returns canned callback payloads for each agent type.
 * Used by decision-workflow-ctrl integration tests.
 */
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const body = JSON.parse(event.body ?? '{}');
  const agentType = body.agentType ?? 'unknown';

  const responses: Record<string, unknown> = {
    InvestorProfile: {
      status: 'COMPLETED',
      output: {
        riskTolerance: 'MODERATE',
        investmentHorizon: 'LONG_TERM',
        financialGoals: ['GROWTH', 'RETIREMENT'],
        constraints: [],
      },
    },
    MarketAnalysis: {
      status: 'COMPLETED',
      output: {
        marketOutlook: 'NEUTRAL',
        sectorRecommendations: ['TECHNOLOGY', 'HEALTHCARE'],
        riskFactors: ['INFLATION', 'INTEREST_RATES'],
        confidenceScore: 0.78,
      },
    },
    Portfolio: {
      status: 'COMPLETED',
      output: {
        proposedTrades: [
          { symbol: 'VTI', side: 'BUY', quantity: 10, targetWeight: 0.6 },
          { symbol: 'BND', side: 'BUY', quantity: 20, targetWeight: 0.4 },
        ],
        expectedReturn: 0.08,
        expectedRisk: 0.12,
      },
    },
    Narrative: {
      status: 'COMPLETED',
      output: {
        explanation: 'Mock portfolio recommendation based on your moderate risk tolerance and long-term growth goals.',
        keyPoints: ['Diversified allocation', 'Low-cost index funds', 'Bond cushion for stability'],
      },
    },
  };

  return json(200, responses[agentType] ?? { status: 'COMPLETED', output: {} });
}
```

- [ ] **Step 3: Add build-mock target**

Add to `services/advisory/decision-workflow-ctrl/project.json`:

```json
"build-mock": {
  "executor": "nx:run-commands",
  "options": {
    "commands": [
      "mkdir -p services/advisory/decision-workflow-ctrl/test/mocks/dist",
      "npx esbuild services/advisory/decision-workflow-ctrl/test/mocks/mock-agent-responses.ts --bundle --platform=node --target=node20 --outfile=services/advisory/decision-workflow-ctrl/test/mocks/dist/index.mjs --format=esm",
      "cd services/advisory/decision-workflow-ctrl/test/mocks/dist && zip -j ../mock-agent-responses.zip index.mjs"
    ],
    "parallel": false
  },
  "outputs": ["services/advisory/decision-workflow-ctrl/test/mocks/mock-agent-responses.zip"]
}
```

Build:
```bash
pnpm nx build-mock decision-workflow-ctrl
```

- [ ] **Step 4: Rewrite integration test**

Replace `services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts`:

```typescript
import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  DdbSeedFixture,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('decision-workflow-ctrl', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;
  let seeder: DdbSeedFixture;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();
    seeder = new DdbSeedFixture(ctx);

    await trap.deploy({
      bus: 'advisory',
      detailType: [
        'WORKFLOW_TRIGGER',
        'DECISION_PACKET',
        'AGENT_OUTPUT',
      ],
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  // ── Trigger Ingress ─────────────────────────────────────────────────

  it('should write WorkflowTrigger on MANDATE_CREATED', async () => {
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'MANDATE_CREATED',
      detail: {
        mandateId: `integ-mandate-${Date.now()}`,
        tenantId: ctx.tenantId,
        riskTolerance: 'MODERATE',
        investmentHorizon: 'LONG_TERM',
        targetReturn: 0.08,
        createdAt: new Date().toISOString(),
      },
    });

    const item = await table.waitForItem({
      table: 'decision-workflow-ctrl',
      pk: `T#${ctx.tenantId}`,
      timeoutMs: 60_000,
    });

    expect(item['__typename']).toBe('WorkflowTrigger');
    expect(item['trigger']).toBe('MANDATE_CREATED');
  }, 120_000);

  it('should write WorkflowTrigger on GOAL_CREATED', async () => {
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'GOAL_CREATED',
      detail: {
        goalId: `integ-goal-${Date.now()}`,
        tenantId: ctx.tenantId,
        objective: 'GROWTH',
        targetAmountCents: 500_000_00,
      },
    });

    const item = await table.waitForItem({
      table: 'decision-workflow-ctrl',
      pk: `T#${ctx.tenantId}`,
      timeoutMs: 60_000,
    });

    expect(item['__typename']).toBe('WorkflowTrigger');
    expect(item['trigger']).toBe('GOAL_CREATED');
  }, 120_000);

  it('should emit WORKFLOW_TRIGGER CDC event', async () => {
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'PORTFOLIO_DRIFT_DETECTED',
      detail: {
        tenantId: ctx.tenantId,
        driftPercent: 5.2,
        detectedAt: new Date().toISOString(),
      },
    });

    const event = await trap.waitForEvent({ detailType: 'WORKFLOW_TRIGGER', timeoutMs: 60_000 });
    expect(event.detailType).toBe('WORKFLOW_TRIGGER');
    expect(event.detail.context.tenantId).toBe(ctx.tenantId);
  }, 120_000);

  // ── Callback Ingress ────────────────────────────────────────────────
  // Full SF lifecycle tests require sending trigger → waiting for SF to start →
  // sending agent callbacks in sequence. These are long-running (120-180s).
  // The subagent implementing this should:
  // 1. Read sfn-callback.ts to understand the callback mechanism
  // 2. Determine if a trigger event can start the SF and whether callback events
  //    can be sent after a delay to resume it
  // 3. If feasible, add a full lifecycle test. If not, document why.
});
```

- [ ] **Step 5: Run integration tests**

```bash
pnpm nx build-mock decision-workflow-ctrl && pnpm nx test-integration decision-workflow-ctrl
```

- [ ] **Step 6: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/
git commit -m "feat(decision-workflow-ctrl): expand integration tests — trigger paths + CDC"
```

---

## Handoff to Plan D

After completing all 8 tasks, copy-paste this prompt to start Plan D in a fresh context:

```
Use `superpowers:subagent-driven-development` to execute the plan at `docs/superpowers/plans/2026-04-07-integration-test-full-coverage-D-bffs.md`.

Branch: `feat/all-services-integration-tests` (continue on it).

Pre-requisites completed (Plans A + B + C):
- All shared infrastructure fixtures deployed (DdbSeedFixture, TableAssertions auto-cleanup, SSM base URLs)
- All 5 adapter mocks built and integration tests passing
- All 6 controller + 2 orchestration services expanded
- Mock agent pattern established (advisory-ctrl + decision-workflow-ctrl)
- AppSync mutation pattern established in advisory-bff (CognitoFixture + AppSyncClient + DdbSeedFixture)

Existing fixtures: EventBridgeClient, EventBusTrap, TableAssertions (with registerCleanup), MockApiFixture, SsmOverrideFixture, DdbSeedFixture, CognitoFixture, AppSyncClient, AccountSeedingFixture

Pattern for BFF AppSync tests: see services/advisory/advisory-bff/test/integration/advisory-bff.integration.test.ts and services/investor/investor-bff/test/integration/initiate-deposit.integration.test.ts
```
