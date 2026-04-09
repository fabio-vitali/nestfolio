# Integration Test Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all immediate and short-term issues from the 2026-04-08 integration test full run review — 2 test failures, 3 correctness issues, 5 quality/cleanup issues, and 2 housekeeping items.

**Architecture:** All changes fall into three categories: (1) CDK stack fixes for adapter EB Rule source filters, (2) test code fixes for cleanup/assertion correctness, (3) integration-testing library enhancements for cleanup and open handles. A batched deploy of all affected services at the end validates everything.

**Tech Stack:** CDK (CfnRule L1 overrides), Jest integration tests, @nestfolio/integration-testing fixtures, EventBridge $or patterns.

---

## File Structure

### CDK Stack Changes (4 adapter stacks)
- `services/execution/execution-adpt/src/service.stack.ts` — Replace Match.anyOf with L1 $or (2 rules)
- `services/advisory/advisory-adpt/src/service.stack.ts` — Replace Match.anyOf with L1 $or (3 rules)
- `services/investor/investor-adpt/src/service.stack.ts` — Replace Match.anyOf with L1 $or (3 rules)
- `services/ledger/ledger-adpt/src/service.stack.ts` — Replace Match.anyOf with L1 $or (1 rule)

### Integration Testing Library Changes
- `libs/integration-testing/src/fixtures/account-seeding.fixture.ts` — Add registerCleanup()
- `libs/integration-testing/src/fixtures/event-bridge-client.ts` — Add destroy()
- `libs/integration-testing/src/context.ts` — Register client destruction on cleanup

### Test File Changes (existing)
- `services/advisory/advisory-ctrl/test/integration/advisory-ctrl.integration.test.ts` — Remove try/catch on CDC assertions
- `services/advisory/advisory-narrative-ctrl/test/integration/advisory-narrative-ctrl.integration.test.ts` — Add registerCleanup + EventBusTrap
- `services/advisory/investor-profile-ctrl/test/integration/investor-profile-ctrl.integration.test.ts` — Add registerCleanup + EventBusTrap
- `services/advisory/market-intelligence-ctrl/test/integration/market-intelligence-ctrl.integration.test.ts` — Add registerCleanup + EventBusTrap
- `services/advisory/portfolio-engine-ctrl/test/integration/portfolio-engine-ctrl.integration.test.ts` — Add registerCleanup + EventBusTrap
- `services/ledger/ledger-ctrl/test/integration/ledger-ctrl.integration.test.ts` — Remove describe.skip
- `services/execution/broker-ctrl/test/integration/broker-ctrl.integration.test.ts` — Replace DdbSeedFixture with event-driven fixture

### Test File Changes (move)
- `services/execution/broker-ctrl/test/integration/order-lifecycle.test.ts` → `services/execution/broker-ctrl/test/order-lifecycle.test.ts`

### New Test Files (adapter bus coverage)
- `services/investor/investor-adpt/test/integration/from-advisory.integration.test.ts`
- `services/investor/investor-adpt/test/integration/from-ledger.integration.test.ts`
- `services/ledger/ledger-adpt/test/integration/from-advisory.integration.test.ts`
- `services/advisory/advisory-adpt/test/integration/from-investor.integration.test.ts` (already exists — verify)

---

## Task 1: Fix Adapter EB Rule Source Filters (4 stacks)

**Root cause:** All 4 adapter stacks use CDK L2 `Match.anyOf(Match.anythingButPrefix, Match.prefix)` which synthesizes to a flat array content filter. EventBridge evaluates this as AND (not OR), causing `integration-test:*` sources to be rejected. The fix is to use the same L1 `$or` override that the Ingress construct uses at `libs/cdk-constructs/src/core/ingress.ts:118-131`.

**Files:**
- Modify: `services/execution/execution-adpt/src/service.stack.ts`
- Modify: `services/advisory/advisory-adpt/src/service.stack.ts`
- Modify: `services/investor/investor-adpt/src/service.stack.ts`
- Modify: `services/ledger/ledger-adpt/src/service.stack.ts`

- [ ] **Step 1: Fix execution-adpt (2 rules)**

Replace the import and both rules:

```typescript
// services/execution/execution-adpt/src/service.stack.ts
// Line 2: Change import
import { CfnRule, EventBus, Rule } from 'aws-cdk-lib/aws-events';
// (Remove Match from imports — no longer needed)
```

Replace the FromAdvisory rule (lines 35-51):

```typescript
    const fromAdvisoryEvents = [
      ExecutionIngestEventTypes.DECISION_APPROVED,
      ExecutionIngestEventTypes.DECISION_PACKET_CREATED,
      ExecutionIngestEventTypes.USER_CONFIRMED,
      ExecutionIngestEventTypes.CIRCUIT_BREAKER_TRIGGERED,
      ExecutionIngestEventTypes.CIRCUIT_BREAKER_RESET,
    ];
    const fromAdvisoryRule = new Rule(this, 'ExecutionIngress-FromAdvisory', {
      eventBus: advisoryBus,
      eventPattern: { detailType: fromAdvisoryEvents },
      targets: [new EventBusTarget(executionBus, { deadLetterQueue: fromAdvisoryDlq })],
    });
    (fromAdvisoryRule.node.defaultChild as CfnRule).addPropertyOverride('EventPattern', {
      '$or': [
        { 'detail-type': fromAdvisoryEvents, 'source': [{ 'anything-but': { 'prefix': 'integration-test:' } }] },
        { 'detail-type': fromAdvisoryEvents, 'source': [{ 'prefix': `integration-test:${serviceName}` }] },
      ],
    });
```

Replace the FromInvestor rule (lines 58-73):

```typescript
    const fromInvestorEvents = [
      ExecutionIngestEventTypes.DEPOSIT_INITIATED,
      ExecutionIngestEventTypes.WITHDRAWAL_REQUESTED,
      ExecutionIngestEventTypes.ACCOUNT_CLOSURE_REQUESTED,
      ExecutionIngestEventTypes.EXECUTION_MODE_CHANGED,
    ];
    const fromInvestorRule = new Rule(this, 'ExecutionIngress-FromInvestor', {
      eventBus: investorBus,
      eventPattern: { detailType: fromInvestorEvents },
      targets: [new EventBusTarget(executionBus, { deadLetterQueue: fromInvestorDlq })],
    });
    (fromInvestorRule.node.defaultChild as CfnRule).addPropertyOverride('EventPattern', {
      '$or': [
        { 'detail-type': fromInvestorEvents, 'source': [{ 'anything-but': { 'prefix': 'integration-test:' } }] },
        { 'detail-type': fromInvestorEvents, 'source': [{ 'prefix': `integration-test:${serviceName}` }] },
      ],
    });
```

- [ ] **Step 2: Fix advisory-adpt (3 rules)**

```typescript
// services/advisory/advisory-adpt/src/service.stack.ts
// Line 2: Change import
import { CfnRule, EventBus, Rule } from 'aws-cdk-lib/aws-events';
```

Replace FromInvestor rule (lines 38-56):

```typescript
    const fromInvestorEvents = [
      AdvisoryIngestEventTypes.GOAL_CREATED,
      AdvisoryIngestEventTypes.GOAL_UPDATED,
      AdvisoryIngestEventTypes.RISK_PROFILE_CREATED,
      AdvisoryIngestEventTypes.RISK_PROFILE_UPDATED,
      AdvisoryIngestEventTypes.OPERATING_MODE_CHANGED,
      AdvisoryIngestEventTypes.MANDATE_CREATED,
      AdvisoryIngestEventTypes.MANDATE_UPDATED,
    ];
    const fromInvestorRule = new Rule(this, 'AdvisoryIngress-FromInvestor', {
      eventBus: investorBus,
      eventPattern: { detailType: fromInvestorEvents },
      targets: [new EventBusTarget(advisoryBus, { deadLetterQueue: fromInvestorDlq })],
    });
    (fromInvestorRule.node.defaultChild as CfnRule).addPropertyOverride('EventPattern', {
      '$or': [
        { 'detail-type': fromInvestorEvents, 'source': [{ 'anything-but': { 'prefix': 'integration-test:' } }] },
        { 'detail-type': fromInvestorEvents, 'source': [{ 'prefix': `integration-test:${serviceName}` }] },
      ],
    });
```

Replace FromExecution rule (lines 63-78):

```typescript
    const fromExecutionEvents = [
      AdvisoryIngestEventTypes.ORDER_FILLED,
      AdvisoryIngestEventTypes.ORDER_REJECTED,
      AdvisoryIngestEventTypes.ORDER_CANCELLED,
      AdvisoryIngestEventTypes.DEPOSIT_DETECTED,
    ];
    const fromExecutionRule = new Rule(this, 'AdvisoryIngress-FromExecution', {
      eventBus: executionBus,
      eventPattern: { detailType: fromExecutionEvents },
      targets: [new EventBusTarget(advisoryBus, { deadLetterQueue: fromExecutionDlq })],
    });
    (fromExecutionRule.node.defaultChild as CfnRule).addPropertyOverride('EventPattern', {
      '$or': [
        { 'detail-type': fromExecutionEvents, 'source': [{ 'anything-but': { 'prefix': 'integration-test:' } }] },
        { 'detail-type': fromExecutionEvents, 'source': [{ 'prefix': `integration-test:${serviceName}` }] },
      ],
    });
```

Replace FromLedger rule (lines 85-98):

```typescript
    const fromLedgerEvents = [
      AdvisoryIngestEventTypes.PORTFOLIO_UPDATED,
      AdvisoryIngestEventTypes.PORTFOLIO_DRIFT_DETECTED,
    ];
    const fromLedgerRule = new Rule(this, 'AdvisoryIngress-FromLedger', {
      eventBus: ledgerBus,
      eventPattern: { detailType: fromLedgerEvents },
      targets: [new EventBusTarget(advisoryBus, { deadLetterQueue: fromLedgerDlq })],
    });
    (fromLedgerRule.node.defaultChild as CfnRule).addPropertyOverride('EventPattern', {
      '$or': [
        { 'detail-type': fromLedgerEvents, 'source': [{ 'anything-but': { 'prefix': 'integration-test:' } }] },
        { 'detail-type': fromLedgerEvents, 'source': [{ 'prefix': `integration-test:${serviceName}` }] },
      ],
    });
```

- [ ] **Step 3: Fix investor-adpt (3 rules)**

```typescript
// services/investor/investor-adpt/src/service.stack.ts
// Line 2: Change import
import { CfnRule, EventBus, Rule } from 'aws-cdk-lib/aws-events';
```

Replace FromAdvisory rule (lines 38-59):

```typescript
    const fromAdvisoryEvents = [
      InvestorIngestEventTypes.DECISION_PACKET_CREATED,
      InvestorIngestEventTypes.USER_CONFIRMATION_REQUESTED,
      InvestorIngestEventTypes.EXPLANATION_GENERATED,
      InvestorIngestEventTypes.DECISION_APPROVED,
      InvestorIngestEventTypes.DECISION_BLOCKED,
      InvestorIngestEventTypes.ESCALATION_TRIGGERED,
      InvestorIngestEventTypes.CIRCUIT_BREAKER_TRIGGERED,
      InvestorIngestEventTypes.CIRCUIT_BREAKER_RESET,
      InvestorIngestEventTypes.INCIDENT_DETECTED,
      InvestorIngestEventTypes.INCIDENT_RESOLVED,
    ];
    const fromAdvisoryRule = new Rule(this, 'InvestorIngress-FromAdvisory', {
      eventBus: advisoryBus,
      eventPattern: { detailType: fromAdvisoryEvents },
      targets: [new EventBusTarget(investorBus, { deadLetterQueue: fromAdvisoryDlq })],
    });
    (fromAdvisoryRule.node.defaultChild as CfnRule).addPropertyOverride('EventPattern', {
      '$or': [
        { 'detail-type': fromAdvisoryEvents, 'source': [{ 'anything-but': { 'prefix': 'integration-test:' } }] },
        { 'detail-type': fromAdvisoryEvents, 'source': [{ 'prefix': `integration-test:${serviceName}` }] },
      ],
    });
```

Replace FromExecution rule (lines 66-85):

```typescript
    const fromExecutionEvents = [
      InvestorIngestEventTypes.ORDER_STAGED,
      InvestorIngestEventTypes.ORDER_FILLED,
      InvestorIngestEventTypes.ORDER_REJECTED,
      InvestorIngestEventTypes.ORDER_CANCELLED,
      InvestorIngestEventTypes.WITHDRAWAL_COMPLETED,
      InvestorIngestEventTypes.ORDER_ESCALATED,
      InvestorIngestEventTypes.BROKER_CIRCUIT_OPEN,
      InvestorIngestEventTypes.TRANSFER_FAILED,
    ];
    const fromExecutionRule = new Rule(this, 'InvestorIngress-FromExecution', {
      eventBus: executionBus,
      eventPattern: { detailType: fromExecutionEvents },
      targets: [new EventBusTarget(investorBus, { deadLetterQueue: fromExecutionDlq })],
    });
    (fromExecutionRule.node.defaultChild as CfnRule).addPropertyOverride('EventPattern', {
      '$or': [
        { 'detail-type': fromExecutionEvents, 'source': [{ 'anything-but': { 'prefix': 'integration-test:' } }] },
        { 'detail-type': fromExecutionEvents, 'source': [{ 'prefix': `integration-test:${serviceName}` }] },
      ],
    });
```

Replace FromLedger rule (lines 92-108):

```typescript
    const fromLedgerEvents = [
      InvestorIngestEventTypes.BALANCE_UPDATED,
      InvestorIngestEventTypes.PORTFOLIO_UPDATED,
      InvestorIngestEventTypes.LEDGER_ENTRY_RECORDED,
      InvestorIngestEventTypes.RECONCILIATION_COMPLETED,
      InvestorIngestEventTypes.LEDGER_PROCESSING_FAILED,
    ];
    const fromLedgerRule = new Rule(this, 'InvestorIngress-FromLedger', {
      eventBus: ledgerBus,
      eventPattern: { detailType: fromLedgerEvents },
      targets: [new EventBusTarget(investorBus, { deadLetterQueue: fromLedgerDlq })],
    });
    (fromLedgerRule.node.defaultChild as CfnRule).addPropertyOverride('EventPattern', {
      '$or': [
        { 'detail-type': fromLedgerEvents, 'source': [{ 'anything-but': { 'prefix': 'integration-test:' } }] },
        { 'detail-type': fromLedgerEvents, 'source': [{ 'prefix': `integration-test:${serviceName}` }] },
      ],
    });
```

- [ ] **Step 4: Fix ledger-adpt (1 rule)**

```typescript
// services/ledger/ledger-adpt/src/service.stack.ts
// Line 2: Change import
import { CfnRule, EventBus, Rule } from 'aws-cdk-lib/aws-events';
```

Replace FromExecution rule (lines 32-54):

```typescript
    const fromExecutionEvents = [
      LedgerIngestEventTypes.ORDER_FILLED,
      LedgerIngestEventTypes.ORDER_PARTIALLY_FILLED,
      LedgerIngestEventTypes.ORDER_REJECTED,
      LedgerIngestEventTypes.ORDER_CANCELLED,
      LedgerIngestEventTypes.DEPOSIT_DETECTED,
      LedgerIngestEventTypes.WITHDRAWAL_COMPLETED,
      LedgerIngestEventTypes.TRANSFER_FAILED,
      LedgerIngestEventTypes.CORPORATE_ACTION_APPLIED,
      LedgerIngestEventTypes.PORTFOLIO_SNAPSHOT_IMPORTED,
      LedgerIngestEventTypes.ALPACA_ACCOUNT_SNAPSHOT,
      LedgerIngestEventTypes.DECISION_PACKET_CREATED,
    ];
    const fromExecutionRule = new Rule(this, 'LedgerIngress-FromExecution', {
      eventBus: executionBus,
      eventPattern: { detailType: fromExecutionEvents },
      targets: [new EventBusTarget(ledgerBus, { deadLetterQueue: fromExecutionDlq })],
    });
    (fromExecutionRule.node.defaultChild as CfnRule).addPropertyOverride('EventPattern', {
      '$or': [
        { 'detail-type': fromExecutionEvents, 'source': [{ 'anything-but': { 'prefix': 'integration-test:' } }] },
        { 'detail-type': fromExecutionEvents, 'source': [{ 'prefix': `integration-test:${serviceName}` }] },
      ],
    });
```

- [ ] **Step 5: Run unit tests for all 4 adapter stacks**

```bash
pnpm nx run-many -t test -p execution-adpt advisory-adpt investor-adpt ledger-adpt --parallel=4
```

Expected: All PASS (CDK snapshot tests may need updating — run with `--updateSnapshot` if snapshots exist).

- [ ] **Step 6: Commit**

```bash
git add services/execution/execution-adpt/src/service.stack.ts \
      services/advisory/advisory-adpt/src/service.stack.ts \
      services/investor/investor-adpt/src/service.stack.ts \
      services/ledger/ledger-adpt/src/service.stack.ts
git commit -m "fix(adapters): replace Match.anyOf with L1 \$or pattern for EB Rules

Match.anyOf(anythingButPrefix, prefix) produces a flat array content filter
that EventBridge evaluates as AND, not OR. This breaks integration-test:*
source matching. Switch to the same L1 \$or override used by the Ingress
construct (cdk-constructs/core/ingress.ts:118-131).

Fixes: execution-adpt from-investor, advisory-adpt from-ledger test failures."
```

---

## Task 2: Remove try/catch from advisory-ctrl CDC Assertions

**Root cause:** All 11 agent trigger events have CDC assertions wrapped in try/catch blocks that swallow timeouts. This means CDC assertions NEVER fail the test even if egress is broken — giving a false sense of coverage.

**Files:**
- Modify: `services/advisory/advisory-ctrl/test/integration/advisory-ctrl.integration.test.ts:358-398`

- [ ] **Step 1: Replace the try/catch CDC assertion block**

In the `it.each(triggerEvents)` test (lines 358-398), replace the body:

```typescript
    it.each(triggerEvents)(
      'should process $detailType and emit DECISION_PACKET_CREATED via CDC',
      async ({ detailType, detail }) => {
        await eb.putEvent({
          bus: 'advisory',
          targetService: 'advisory-ctrl',
          detailType,
          detail: {
            ...detail,
            tenantId: ctx.tenantId,
          },
        });

        const cdcEvent = await trap.waitForEvent({
          detailType: 'DECISION_PACKET_CREATED',
          timeoutMs: 30_000,
        });
        expect(cdcEvent.detailType).toBe('DECISION_PACKET_CREATED');
        expect(cdcEvent.detail).toBeDefined();
      },
      60_000,
    );
```

- [ ] **Step 2: Also remove the try/catch from the DECISION_BLOCKED test (line 127-132)**

Replace lines 125-132 with a direct assertion:

```typescript
      // Verify CDC egress — the UpdateCommand triggers a DDB Stream event.
      const cdcEvent = await trap.waitForEvent({ detailType: 'DECISION_PACKET_CREATED', timeoutMs: 30_000 });
      expect(cdcEvent.detailType).toBe('DECISION_PACKET_CREATED');
```

- [ ] **Step 3: Commit**

```bash
git add services/advisory/advisory-ctrl/test/integration/advisory-ctrl.integration.test.ts
git commit -m "fix(advisory-ctrl): make CDC assertions mandatory in agent trigger tests

Removes try/catch wrappers that swallowed CDC assertion timeouts,
giving false sense of egress coverage. CDC events must now arrive
or the test fails."
```

---

## Task 3: Add registerCleanup() to 4 Agent Service Tests

**Root cause:** 4 agent service tests create DDB items via `table.waitForItem()` but never call `table.registerCleanup()`, so items accumulate across test runs.

**Files:**
- Modify: `services/advisory/advisory-narrative-ctrl/test/integration/advisory-narrative-ctrl.integration.test.ts:17`
- Modify: `services/advisory/investor-profile-ctrl/test/integration/investor-profile-ctrl.integration.test.ts`
- Modify: `services/advisory/market-intelligence-ctrl/test/integration/market-intelligence-ctrl.integration.test.ts`
- Modify: `services/advisory/portfolio-engine-ctrl/test/integration/portfolio-engine-ctrl.integration.test.ts`

- [ ] **Step 1: Fix advisory-narrative-ctrl**

Add `table.registerCleanup();` after line 16 (`table = new TableAssertions(ctx);`):

```typescript
  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();
  }, 60_000);
```

- [ ] **Step 2: Fix investor-profile-ctrl**

Same pattern — add `table.registerCleanup();` after `table = new TableAssertions(ctx);` in beforeAll.

- [ ] **Step 3: Fix market-intelligence-ctrl**

Same pattern — add `table.registerCleanup();` after `table = new TableAssertions(ctx);` in beforeAll.

- [ ] **Step 4: Fix portfolio-engine-ctrl**

Same pattern — add `table.registerCleanup();` after `table = new TableAssertions(ctx);` in beforeAll.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/advisory-narrative-ctrl/test/integration/advisory-narrative-ctrl.integration.test.ts \
      services/advisory/investor-profile-ctrl/test/integration/investor-profile-ctrl.integration.test.ts \
      services/advisory/market-intelligence-ctrl/test/integration/market-intelligence-ctrl.integration.test.ts \
      services/advisory/portfolio-engine-ctrl/test/integration/portfolio-engine-ctrl.integration.test.ts
git commit -m "fix(agent-tests): add registerCleanup to 4 agent service integration tests

advisory-narrative-ctrl, investor-profile-ctrl, market-intelligence-ctrl,
and portfolio-engine-ctrl were missing table.registerCleanup() causing
DDB items to accumulate across test runs."
```

---

## Task 4: Add Cleanup to AccountSeedingFixture

**Root cause:** `AccountSeedingFixture.seed()` writes DDB items but never registers a cleanup handler. Items accumulate with each test run (scoped by tenantId, so no interference, but grows DDB tables).

**Files:**
- Modify: `libs/integration-testing/src/fixtures/account-seeding.fixture.ts`

- [ ] **Step 1: Add registerCleanup method and tracking**

```typescript
// libs/integration-testing/src/fixtures/account-seeding.fixture.ts
import { DynamoDBClient, PutItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import type { IntegrationContext } from '../context';

export interface AccountSeedOptions {
  readonly cashBalanceCents?: number;
  readonly positions?: Record<string, { symbol: string; quantity: number; averageCostBasis: number; totalCostBasis: number; lastFillPrice: number }>;
  readonly streamType?: 'actual' | 'simulated';
}

export class AccountSeedingFixture {
  private readonly client: DynamoDBClient;
  private readonly ctx: IntegrationContext;
  private readonly seededItems: { tableName: string; pk: string; sk: string }[] = [];

  constructor(ctx: IntegrationContext) {
    this.ctx = ctx;
    this.client = new DynamoDBClient({ region: ctx.region });
  }

  registerCleanup(): void {
    this.ctx.cleanup.register('AccountSeedingFixture', async () => {
      for (const { tableName, pk, sk } of this.seededItems.reverse()) {
        try {
          await this.client.send(new DeleteItemCommand({
            TableName: tableName,
            Key: marshall({ pk, sk }),
          }));
        } catch (err) {
          console.error(`AccountSeedingFixture cleanup failed: pk=${pk} sk=${sk}`, err);
        }
      }
      this.client.destroy();
    });
  }

  async seed(serviceName: string, options?: AccountSeedOptions): Promise<void> {
    const tableName = await this.ctx.ssm.tableName(serviceName);
    const streamType = options?.streamType ?? 'actual';
    const pk = `Account#${this.ctx.tenantId}#${streamType}`;
    const sk = 'Snapshot#latest';
    const now = new Date().toISOString();

    const item = {
      pk,
      sk,
      __typename: 'AccountSnapshot',
      tenantId: this.ctx.tenantId,
      timestamp: now,
      streamType,
      positions: options?.positions ?? {},
      cashBalanceCents: options?.cashBalanceCents ?? 1_000_000,
      totalValueCents: options?.cashBalanceCents ?? 1_000_000,
      positionCount: Object.keys(options?.positions ?? {}).length,
      lastEventSequence: 0,
      version: 1,
      snapshotAt: now,
    };

    await this.client.send(new PutItemCommand({
      TableName: tableName,
      Item: marshall(item, { removeUndefinedValues: true }),
    }));

    this.seededItems.push({ tableName, pk, sk });
  }
}
```

- [ ] **Step 2: Run integration-testing lib unit tests (if any)**

```bash
pnpm nx test integration-testing
```

Expected: PASS (or no test target — the fixture has no unit tests).

- [ ] **Step 3: Commit**

```bash
git add libs/integration-testing/src/fixtures/account-seeding.fixture.ts
git commit -m "fix(integration-testing): add registerCleanup to AccountSeedingFixture

Tracks seeded items and deletes them in LIFO order during cleanup.
Also destroys the internal DynamoDB client to prevent open handles."
```

---

## Task 5: Add EventBusTrap to Agent Service Tests

**Root cause:** 4 agent service tests (advisory-narrative-ctrl, investor-profile-ctrl, market-intelligence-ctrl, portfolio-engine-ctrl) only assert DDB writes but never verify CDC output via EventBusTrap.

**Files:**
- Modify: `services/advisory/advisory-narrative-ctrl/test/integration/advisory-narrative-ctrl.integration.test.ts`
- Modify: `services/advisory/investor-profile-ctrl/test/integration/investor-profile-ctrl.integration.test.ts`
- Modify: `services/advisory/market-intelligence-ctrl/test/integration/market-intelligence-ctrl.integration.test.ts`
- Modify: `services/advisory/portfolio-engine-ctrl/test/integration/portfolio-engine-ctrl.integration.test.ts`

- [ ] **Step 1: Enhance advisory-narrative-ctrl test**

Replace the full test file with CDC verification added:

```typescript
import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('advisory-narrative-ctrl: GENERATE_NARRATIVE -> AgentInvocation DDB write + CDC', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let table: TableAssertions;
  let trap: EventBusTrap;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    table = new TableAssertions(ctx);
    trap = new EventBusTrap(ctx);
    table.registerCleanup();

    await trap.deploy({
      bus: 'advisory',
      detailType: ['AGENT_INVOCATION_CREATED', 'EXPLANATION_GENERATED'],
    });
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 30_000);

  it('should write AgentInvocation record to DDB on GENERATE_NARRATIVE', async () => {
    const decisionId = `integ-narrative-${Date.now()}`;

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'advisory-narrative-ctrl',
      detailType: 'GENERATE_NARRATIVE',
      detail: {
        tenantId: ctx.tenantId,
        decisionId,
        taskToken: 'integ-task-token',
      },
    });

    const item = await table.waitForItem({
      table: 'advisory-narrative-ctrl',
      pk: `DECISION#${decisionId}`,
      timeoutMs: 60_000,
    });

    expect(item['__typename']).toBe('AgentInvocation');
    expect(item['tenantId']).toBe(ctx.tenantId);
    expect(item['agentName']).toBe('explainability');
    expect(item['decisionId']).toBe(decisionId);

    // Verify CDC emission
    const cdcEvent = await trap.waitForEvent({
      detailType: 'AGENT_INVOCATION_CREATED',
      timeoutMs: 30_000,
    });
    expect(cdcEvent.detailType).toBe('AGENT_INVOCATION_CREATED');
  }, 120_000);
});
```

- [ ] **Step 2: Enhance investor-profile-ctrl test**

Same pattern: add EventBusTrap import, deploy trap for `AGENT_INVOCATION_CREATED`, assert CDC after DDB assertion. Use the same structure as Step 1 but with the service's own event types and detail payloads.

Read the existing test file first to get the exact detailType and detail payloads, then add:
- `EventBusTrap` import
- `let trap: EventBusTrap;` declaration
- `trap = new EventBusTrap(ctx);` in beforeAll
- `await trap.deploy({ bus: 'advisory', detailType: ['AGENT_INVOCATION_CREATED'] });` in beforeAll
- CDC assertion at end of each test

- [ ] **Step 3: Enhance market-intelligence-ctrl test**

Same pattern as Step 2. Read the existing test file first, then add EventBusTrap with CDC assertion.

- [ ] **Step 4: Enhance portfolio-engine-ctrl test**

Same pattern as Step 2. Read the existing test file first, then add EventBusTrap with CDC assertion.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/advisory-narrative-ctrl/test/integration/advisory-narrative-ctrl.integration.test.ts \
      services/advisory/investor-profile-ctrl/test/integration/investor-profile-ctrl.integration.test.ts \
      services/advisory/market-intelligence-ctrl/test/integration/market-intelligence-ctrl.integration.test.ts \
      services/advisory/portfolio-engine-ctrl/test/integration/portfolio-engine-ctrl.integration.test.ts
git commit -m "feat(agent-tests): add EventBusTrap CDC verification to 4 agent service tests

advisory-narrative-ctrl, investor-profile-ctrl, market-intelligence-ctrl,
and portfolio-engine-ctrl now verify CDC emission via EventBusTrap
in addition to DDB write assertions."
```

---

## Task 6: Add Missing Adapter Bus Coverage Tests

**Root cause:** investor-adpt tests 1/3 source buses, ledger-adpt tests 1/1 (but only Execution, missing Advisory and Investor sources if applicable). The review shows investor-adpt is missing Advisory->Investor and Ledger->Investor tests.

**Files:**
- Create: `services/investor/investor-adpt/test/integration/from-advisory.integration.test.ts`
- Create: `services/investor/investor-adpt/test/integration/from-ledger.integration.test.ts`

- [ ] **Step 1: Create from-advisory test for investor-adpt**

```typescript
// services/investor/investor-adpt/test/integration/from-advisory.integration.test.ts
import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('investor-adpt: Advisory -> Investor forwarding', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);

    await trap.deploy({
      bus: 'investor',
      detailType: 'DECISION_PACKET_CREATED',
    });
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 30_000);

  it('should forward DECISION_PACKET_CREATED from AdvisoryBus to InvestorBus', async () => {
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'investor-adpt',
      detailType: 'DECISION_PACKET_CREATED',
      detail: {
        decisionId: `integ-decision-${Date.now()}`,
        portfolioId: 'test-portfolio-001',
      },
    });

    const event = await trap.waitForEvent();
    expect(event.detailType).toBe('DECISION_PACKET_CREATED');
    expect(event.detail.context.tenantId).toBe(ctx.tenantId);
  }, 60_000);
});
```

- [ ] **Step 2: Create from-ledger test for investor-adpt**

```typescript
// services/investor/investor-adpt/test/integration/from-ledger.integration.test.ts
import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('investor-adpt: Ledger -> Investor forwarding', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);

    await trap.deploy({
      bus: 'investor',
      detailType: 'BALANCE_UPDATED',
    });
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 30_000);

  it('should forward BALANCE_UPDATED from LedgerBus to InvestorBus', async () => {
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'investor-adpt',
      detailType: 'BALANCE_UPDATED',
      detail: {
        portfolioId: `integ-portfolio-${Date.now()}`,
        cashBalanceCents: 500000,
      },
    });

    const event = await trap.waitForEvent();
    expect(event.detailType).toBe('BALANCE_UPDATED');
    expect(event.detail.context.tenantId).toBe(ctx.tenantId);
  }, 60_000);
});
```

- [ ] **Step 3: Commit**

```bash
git add services/investor/investor-adpt/test/integration/from-advisory.integration.test.ts \
      services/investor/investor-adpt/test/integration/from-ledger.integration.test.ts
git commit -m "feat(investor-adpt): add integration tests for Advisory and Ledger source buses

Covers 2 of the 3 source buses that were previously untested.
Now 3/3 source buses have at least 1 forwarding test."
```

---

## Task 7: Fix Open Handles in Integration Context

**Root cause:** All 28 test suites emit `Force exiting Jest: --detectOpenHandles` because AWS SDK clients created by fixtures are never destroyed. The fix is to add `destroy()` to fixtures that hold AWS SDK clients and ensure they're called during cleanup.

**Files:**
- Modify: `libs/integration-testing/src/fixtures/event-bridge-client.ts`
- Modify: `libs/integration-testing/src/ssm-cache.ts`

- [ ] **Step 1: Add destroy() to EventBridgeClient**

Add a `destroy()` method and register it in the constructor:

```typescript
// At end of EventBridgeClient class in event-bridge-client.ts
  destroy(): void {
    this.client.destroy();
  }
```

- [ ] **Step 2: Check SsmCache for client cleanup**

Read `libs/integration-testing/src/ssm-cache.ts` — if it holds an SSM client, add `destroy()` the same way. The SSM client is typically the longest-lived client.

- [ ] **Step 3: Register destroys in createIntegrationContext**

The cleanest approach without touching all 28 test files: the fixtures should self-register destruction when their constructor receives the context. However, since the fixtures are instantiated by the test (not the context), the simpler approach is to document the `destroy()` pattern.

An alternative: register a final cleanup in each fixture constructor:
```typescript
// In EventBridgeClient constructor:
constructor(ctx: IntegrationContext) {
  this.ctx = ctx;
  this.client = new AwsEBClient({ region: ctx.region });
  ctx.cleanup.register('EventBridgeClient', () => {
    this.client.destroy();
    return Promise.resolve();
  });
}
```

Apply this pattern to: EventBridgeClient, TableAssertions (if it holds a DDB client), SsmCache, and AccountSeedingFixture. This way `ctx.cleanup.runAll()` automatically destroys all clients without changing test files.

- [ ] **Step 4: Run a single integration test to verify clean shutdown**

```bash
pnpm nx test-integration reconciliation-ctrl
```

Expected: PASS without `Force exiting Jest: --detectOpenHandles` warning.

- [ ] **Step 5: Commit**

```bash
git add libs/integration-testing/src/fixtures/event-bridge-client.ts \
      libs/integration-testing/src/ssm-cache.ts
# (add any other modified fixture files)
git commit -m "fix(integration-testing): auto-destroy AWS SDK clients on cleanup

Fixtures now register client.destroy() with CleanupRegistry in their
constructors. Eliminates 'Force exiting Jest: --detectOpenHandles'
warning across all 28 integration test suites."
```

---

## Task 8: Move broker-ctrl order-lifecycle.test.ts to test/

**Root cause:** `order-lifecycle.test.ts` uses fully-mocked Jest dependencies (no real AWS calls) but lives in `test/integration/`. It's a unit test that should be in `test/`.

**Files:**
- Move: `services/execution/broker-ctrl/test/integration/order-lifecycle.test.ts` -> `services/execution/broker-ctrl/test/order-lifecycle.test.ts`

- [ ] **Step 1: Move the file**

```bash
mv services/execution/broker-ctrl/test/integration/order-lifecycle.test.ts \
   services/execution/broker-ctrl/test/order-lifecycle.test.ts
```

- [ ] **Step 2: Verify unit tests still pass**

```bash
pnpm nx test broker-ctrl
```

Expected: PASS (the test uses `jest.mock` for all AWS SDK clients, no path changes needed since imports are relative to the project root).

- [ ] **Step 3: Verify integration tests still pass (only broker-ctrl.integration.test.ts remains)**

```bash
ls services/execution/broker-ctrl/test/integration/
```

Expected: Only `broker-ctrl.integration.test.ts` remains.

- [ ] **Step 4: Commit**

```bash
git add services/execution/broker-ctrl/test/
git commit -m "refactor(broker-ctrl): move order-lifecycle.test.ts to test/ (unit test)

This file uses fully-mocked jest dependencies with no real AWS calls.
It was misclassified as an integration test."
```

---

## Task 9: Replace DdbSeedFixture in broker-ctrl Integration Test

**Root cause:** `broker-ctrl.integration.test.ts` uses `DdbSeedFixture` to pre-seed ExecutionMode records, violating the "no DDB seeding" project convention. The same test file already demonstrates the correct pattern: the first test publishes `EXECUTION_MODE_CHANGED` and waits for the DDB write.

**Files:**
- Modify: `services/execution/broker-ctrl/test/integration/broker-ctrl.integration.test.ts`

- [ ] **Step 1: Remove DdbSeedFixture import and declaration**

Remove from imports (line 5): `DdbSeedFixture,`
Remove from declarations (line 14): `let seed: DdbSeedFixture;`
Remove from beforeAll (line 22): `seed = new DdbSeedFixture(ctx);`

- [ ] **Step 2: Replace DDB seeding in deposit-withdrawal-router tests**

Replace the DEPOSIT_INITIATED test (lines 194-235). Instead of `seed.seed(...)`, use the event-driven approach:

```typescript
    it('should process DEPOSIT_INITIATED without error when mode=simulation', async () => {
      // Event-driven fixture: set execution mode to simulation
      await eb.putEvent({
        bus: 'execution',
        targetService: 'broker-ctrl',
        detailType: 'EXECUTION_MODE_CHANGED',
        detail: { mode: 'simulation' },
      });

      // Wait for ExecutionMode DDB write (proves mode-listener processed it)
      await table.waitForItem({
        table: 'broker-ctrl',
        pk: `ExecutionMode#${ctx.tenantId}`,
        sk: 'ExecutionMode',
        timeoutMs: 60_000,
      });

      await eb.putEvent({
        bus: 'execution',
        targetService: 'broker-ctrl',
        detailType: 'DEPOSIT_INITIATED',
        detail: {
          depositId: `integ-route-dep-${Date.now()}`,
          amountCents: 75000,
          currency: 'USD',
        },
      });

      // Allow handler time to process (router returns skip(), no DDB write)
      await new Promise(resolve => setTimeout(resolve, 15_000));

      // Verify the ExecutionMode record is readable
      const modeItem = await table.waitForItem({
        table: 'broker-ctrl',
        pk: `ExecutionMode#${ctx.tenantId}`,
        sk: 'ExecutionMode',
      });
      expect(modeItem['mode']).toBe('simulation');
    }, 120_000);
```

- [ ] **Step 3: Replace WITHDRAWAL_REQUESTED test similarly**

Same pattern: publish EXECUTION_MODE_CHANGED first, wait for DDB write, then publish WITHDRAWAL_REQUESTED.

```typescript
    it('should process WITHDRAWAL_REQUESTED without error when mode=simulation', async () => {
      // Event-driven fixture: set execution mode to simulation
      await eb.putEvent({
        bus: 'execution',
        targetService: 'broker-ctrl',
        detailType: 'EXECUTION_MODE_CHANGED',
        detail: { mode: 'simulation' },
      });

      await table.waitForItem({
        table: 'broker-ctrl',
        pk: `ExecutionMode#${ctx.tenantId}`,
        sk: 'ExecutionMode',
        timeoutMs: 60_000,
      });

      await eb.putEvent({
        bus: 'execution',
        targetService: 'broker-ctrl',
        detailType: 'WITHDRAWAL_REQUESTED',
        detail: {
          withdrawalId: `integ-route-wd-${Date.now()}`,
          amount: 30000,
          currency: 'USD',
        },
      });

      await new Promise(resolve => setTimeout(resolve, 15_000));

      const modeItem = await table.waitForItem({
        table: 'broker-ctrl',
        pk: `ExecutionMode#${ctx.tenantId}`,
        sk: 'ExecutionMode',
      });
      expect(modeItem['mode']).toBe('simulation');
    }, 120_000);
```

- [ ] **Step 4: Commit**

```bash
git add services/execution/broker-ctrl/test/integration/broker-ctrl.integration.test.ts
git commit -m "fix(broker-ctrl): replace DdbSeedFixture with event-driven fixture setup

Uses EXECUTION_MODE_CHANGED events + DDB wait instead of direct DDB
seeding, following the project 'no DDB seeding' convention."
```

---

## Task 10: Unskip ledger-ctrl CDC Tests

**Root cause:** CDC chain tests are in `describe.skip` because the deployed Reducer Lambda has a stale sk-prefix query (`begins_with(sk, 'LedgerEntry#')` instead of `begins_with(sk, 'Event#')`). The current source code is correct — a redeploy fixes this. This task removes the skip; the deploy happens in Task 11.

**Files:**
- Modify: `services/ledger/ledger-ctrl/test/integration/ledger-ctrl.integration.test.ts`

- [ ] **Step 1: Remove describe.skip from BALANCE_UPDATED block (line 219)**

Change `describe.skip(` to `describe(` on line 219.

Update the comment block above it (lines 197-217) — remove the "SKIPPED" note and keep just the architecture comment:

```typescript
// ── CDC chain: balance-affecting events -> BALANCE_UPDATED ────────────
// Flow: EB -> SQS -> event-listener (LedgerEntry DDB write) -> DDB Stream ->
//       Reducer (snapshot + derived events) -> DDB Stream -> Egress -> EB
```

- [ ] **Step 2: Remove describe.skip from LEDGER_ENTRY_RECORDED block (line 329)**

Change `describe.skip(` to `describe(` on line 329.

Remove the "SKIPPED" comment on line 328.

- [ ] **Step 3: Commit**

```bash
git add services/ledger/ledger-ctrl/test/integration/ledger-ctrl.integration.test.ts
git commit -m "fix(ledger-ctrl): unskip CDC chain integration tests

Reducer sk-prefix mismatch was in deployed code only. Current source
uses the correct 'Event#' prefix. Tests will pass after redeployment."
```

---

## Task 11: Deploy All Affected Services

**Prerequisite:** All code changes from Tasks 1-10 committed.

**Services to deploy:**
- execution-adpt (Task 1 — $or fix)
- advisory-adpt (Task 1 — $or fix)
- investor-adpt (Task 1 — $or fix, Task 6 — new test needs working rules)
- ledger-adpt (Task 1 — $or fix)
- ledger-ctrl (Task 10 — Reducer sk-prefix fix via redeploy)

- [ ] **Step 1: Run CDK synth for all affected stacks to verify no errors**

```bash
npx cdk synth -c prefix=dev -c region=us-east-1 \
  dev-execution-adpt \
  dev-advisory-adpt \
  dev-investor-adpt \
  dev-ledger-adpt \
  dev-ledger-ctrl \
  --quiet
```

Expected: No synthesis errors.

- [ ] **Step 2: Deploy all affected services**

```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev \
  --stacks="dev-execution-adpt dev-advisory-adpt dev-investor-adpt dev-ledger-adpt dev-ledger-ctrl"
```

Or if the deploy script doesn't support `--stacks`, deploy individually:

```bash
npx cdk deploy dev-execution-adpt dev-advisory-adpt dev-investor-adpt dev-ledger-adpt dev-ledger-ctrl \
  -c prefix=dev -c region=us-east-1 --require-approval never
```

Expected: All 5 stacks deploy successfully.

- [ ] **Step 3: Run the previously-failing integration tests**

```bash
# Adapter forwarding tests (were failing)
pnpm nx test-integration execution-adpt
pnpm nx test-integration advisory-adpt

# Ledger CDC tests (were skipped)
pnpm nx test-integration ledger-ctrl

# New investor-adpt tests
pnpm nx test-integration investor-adpt
```

Expected: All PASS.

- [ ] **Step 4: Run full integration test suite to confirm no regressions**

```bash
pnpm nx run-many -t test-integration --parallel=6
```

Expected: 28/28 PASS (was 26/28).

- [ ] **Step 5: Commit deploy verification notes (optional)**

No code change needed. Update the review document if desired.

---

## Summary

| Task | Issue | Type | Affected Services |
|------|-------|------|-------------------|
| 1 | Adapter EB Rule $or fix | Critical | 4 adapters |
| 2 | advisory-ctrl try/catch removal | Critical | advisory-ctrl |
| 3 | Agent test registerCleanup | Moderate | 4 agent services |
| 4 | AccountSeedingFixture cleanup | Moderate | integration-testing lib |
| 5 | Agent test EventBusTrap | Moderate | 4 agent services |
| 6 | Adapter bus coverage | Minor | investor-adpt |
| 7 | Open handles | Moderate | integration-testing lib |
| 8 | order-lifecycle.test.ts move | Housekeeping | broker-ctrl |
| 9 | DdbSeedFixture replacement | Housekeeping | broker-ctrl |
| 10 | ledger-ctrl CDC unskip | Critical | ledger-ctrl |
| 11 | Deploy batch | Deploy | 5 services |

**Parallelizable tasks:** Tasks 1-4 are independent. Tasks 5-6 depend on Task 3 (registerCleanup). Task 7 is independent. Tasks 8-9 are independent. Task 10 is independent. Task 11 depends on all prior tasks.
