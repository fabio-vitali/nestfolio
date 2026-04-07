# Integration Test Full Coverage — Plan D: BFF AppSync

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand integration tests for the 3 remaining BFF services (investor-bff, dashboard-bff, ledger-bff) with full AppSync mutation/query coverage and event materialization tests.

**Architecture:** BFF tests combine two patterns: (1) event → DDB materialization (same as controllers), and (2) authenticated AppSync GraphQL calls via CognitoFixture + AppSyncClient. Each BFF has a Facade (AppSync) backed by JS resolvers reading/writing DDB. Tests verify mutations trigger DDB writes + CDC events, and queries return correct data from pre-seeded records.

**Tech Stack:** TypeScript, Jest, AppSync (GraphQL), Cognito, DynamoDB, EventBridge

**Branch:** `feat/all-services-integration-tests` (continue from Plan C)

**Design Spec:** `docs/superpowers/specs/2026-04-07-integration-test-full-coverage-design.md`

**Pre-requisites (Plans A + B + C completed):**
- All shared fixtures available: DdbSeedFixture, TableAssertions (registerCleanup), CognitoFixture, AppSyncClient
- AppSync mutation pattern established in advisory-bff (Plan C Task 5)
- BFF event materialization pattern established

**Pattern reference for AppSync tests:** `services/investor/investor-bff/test/integration/initiate-deposit.integration.test.ts` — shows CognitoFixture → AppSyncClient → mutation → DDB assertion → CDC trap

**All 3 tasks are fully independent and can run in parallel.**

---

### Task 1: investor-bff — Expand Integration Tests (Mutations + Queries)

**Files:**
- Rewrite: `services/investor/investor-bff/test/integration/initiate-deposit.integration.test.ts` → rename to `investor-bff.integration.test.ts`

**Context:** investor-bff has:
- **Ingress events** (5): USER_REGISTERED, NOTIFICATION_CREATED, BALANCE_UPDATED, ONBOARDING_COMPLETED, GO_LIVE_CONFIRMED → materialize to DDB
- **Facade (AppSync)** with JS resolvers:
  - Mutations: initiateDeposit, requestWithdrawal, updateGoal, updateMandate, revokeMandate, requestAccountClosure, markNotificationRead
  - Queries: getProfile, getGoals, getNotifications, getUnreadCount

DDB entities: root entity `InvestorProfile` (pk: `InvestorProfile#{tenantId}#{userId}`) with child entities on sk: `Goal#{goalId}`, `Mandate`, `Deposit#{depositId}`, `Withdrawal#{withdrawalId}`, `Notification#{notificationId}`, etc.

CDC events: GOAL_CREATED, GOAL_UPDATED, MANDATE_CREATED, MANDATE_UPDATED, MANDATE_REVOKED, DEPOSIT_INITIATED, WITHDRAWAL_REQUESTED, ACCOUNT_CLOSURE_REQUESTED, NOTIFICATION_READ.

Existing test covers initiateDeposit mutation only.

- [ ] **Step 1: Read investor-bff AppSync schema and resolvers**

Read:
- `services/investor/investor-bff/src/schema.graphql` — get exact mutation/query signatures, input types, return types
- `services/investor/investor-bff/src/resolvers/` — understand how each mutation writes to DDB (pk/sk patterns, field names)
- `services/investor/investor-bff/src/handlers/event-listener.ts` — understand event materialization transforms

This step is critical — the test code must match exact GraphQL field names and input types.

- [ ] **Step 2: Rename test file and rewrite**

Rename `services/investor/investor-bff/test/integration/initiate-deposit.integration.test.ts` to `services/investor/investor-bff/test/integration/investor-bff.integration.test.ts` (update jest config if needed — the glob `**/*.integration.test.ts` should still match).

Replace with expanded test:

```typescript
import {
  createIntegrationContext,
  CognitoFixture,
  AppSyncClient,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  DdbSeedFixture,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('investor-bff', () => {
  let ctx: IntegrationContext;
  let cognito: CognitoFixture;
  let appsync: AppSyncClient;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;
  let seeder: DdbSeedFixture;
  let cognitoSub: string;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    cognito = new CognitoFixture(ctx);
    const tokens = await cognito.setup();
    appsync = new AppSyncClient(ctx, tokens, 'investor-bff');
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();
    seeder = new DdbSeedFixture(ctx);

    // Extract Cognito sub
    const payload = JSON.parse(Buffer.from(tokens.idToken.split('.')[1], 'base64url').toString());
    cognitoSub = payload.sub;

    await trap.deploy({
      bus: 'investor',
      detailType: [
        'DEPOSIT_INITIATED',
        'WITHDRAWAL_REQUESTED',
        'GOAL_UPDATED',
        'MANDATE_UPDATED',
        'MANDATE_REVOKED',
        'ACCOUNT_CLOSURE_REQUESTED',
      ],
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  // ── Mutations ───────────────────────────────────────────────────────

  describe('mutations', () => {
    it('should create deposit and emit DEPOSIT_INITIATED', async () => {
      // Subagent: verify exact mutation signature from schema.graphql
      const result = await appsync.mutate<{
        initiateDeposit: { depositId: string; status: string };
      }>(`
        mutation InitiateDeposit($input: DepositInput!) {
          initiateDeposit(input: $input) { depositId status }
        }
      `, {
        input: { amountCents: 100_000, currency: 'USD' },
      });

      expect(result.initiateDeposit.status).toBe('INITIATED');
      const depositId = result.initiateDeposit.depositId;

      // Verify DDB write
      const item = await table.waitForItem({
        table: 'investor-bff',
        pk: `InvestorProfile#${ctx.tenantId}#${cognitoSub}`,
        sk: `Deposit#${depositId}`,
      });
      expect(item['amountCents']).toBe(100_000);

      // Verify CDC
      const event = await trap.waitForEvent({ detailType: 'DEPOSIT_INITIATED' });
      expect(event.detail.context.tenantId).toBe(ctx.tenantId);
    }, 60_000);

    it('should create withdrawal and emit WITHDRAWAL_REQUESTED', async () => {
      // Subagent: verify exact mutation signature
      const result = await appsync.mutate<{
        requestWithdrawal: { withdrawalId: string; status: string };
      }>(`
        mutation RequestWithdrawal($input: WithdrawalInput!) {
          requestWithdrawal(input: $input) { withdrawalId status }
        }
      `, {
        input: { amountCents: 50_000, currency: 'USD' },
      });

      expect(result.requestWithdrawal.status).toBeDefined();

      const event = await trap.waitForEvent({ detailType: 'WITHDRAWAL_REQUESTED' });
      expect(event.detail.context.tenantId).toBe(ctx.tenantId);
    }, 60_000);

    it('should update goal and emit GOAL_UPDATED', async () => {
      const goalId = `integ-goal-${Date.now()}`;

      // Pre-seed a Goal so the mutation can find it
      await seeder.seed({
        table: 'investor-bff',
        items: [{
          pk: `InvestorProfile#${ctx.tenantId}#${cognitoSub}`,
          sk: `Goal#${goalId}`,
          __typename: 'Goal',
          tenantId: ctx.tenantId,
          userId: cognitoSub,
          goalId,
          objective: 'GROWTH',
          targetAmountCents: 500_000_00,
          targetDate: '2030-01-01',
          createdAt: new Date().toISOString(),
        }],
      });

      // Subagent: verify exact mutation signature and input type
      const result = await appsync.mutate<{
        updateGoal: { goalId: string; objective: string };
      }>(`
        mutation UpdateGoal($goalId: ID!, $input: GoalInput!) {
          updateGoal(goalId: $goalId, input: $input) { goalId objective }
        }
      `, {
        goalId,
        input: { objective: 'RETIREMENT', targetAmountCents: 1_000_000_00, targetDate: '2035-01-01' },
      });

      expect(result.updateGoal.objective).toBe('RETIREMENT');

      const event = await trap.waitForEvent({ detailType: 'GOAL_UPDATED' });
      expect(event.detail.context.tenantId).toBe(ctx.tenantId);
    }, 60_000);

    it('should request account closure', async () => {
      // Subagent: verify mutation signature — may not require input
      const result = await appsync.mutate<{
        requestAccountClosure: { status: string };
      }>(`
        mutation RequestAccountClosure {
          requestAccountClosure { status }
        }
      `);

      expect(result.requestAccountClosure.status).toBeDefined();

      const event = await trap.waitForEvent({ detailType: 'ACCOUNT_CLOSURE_REQUESTED' });
      expect(event.detail.context.tenantId).toBe(ctx.tenantId);
    }, 60_000);
  });

  // ── Queries ─────────────────────────────────────────────────────────

  describe('queries', () => {
    it('should return profile data from getProfile', async () => {
      // Pre-seed InvestorProfile
      await seeder.seed({
        table: 'investor-bff',
        items: [{
          pk: `InvestorProfile#${ctx.tenantId}#${cognitoSub}`,
          sk: 'Profile',
          __typename: 'InvestorProfile',
          tenantId: ctx.tenantId,
          userId: cognitoSub,
          email: 'integ-test@nestfolio.dev',
          displayName: 'Integration Test User',
          createdAt: new Date().toISOString(),
        }],
      });

      // Subagent: verify exact query signature and return fields
      const result = await appsync.query<{
        getProfile: { userId: string; displayName: string };
      }>(`
        query GetProfile {
          getProfile { userId displayName }
        }
      `);

      expect(result.getProfile.displayName).toBe('Integration Test User');
    }, 60_000);

    it('should return goals from getGoals', async () => {
      const goalId = `integ-query-goal-${Date.now()}`;

      await seeder.seed({
        table: 'investor-bff',
        items: [{
          pk: `InvestorProfile#${ctx.tenantId}#${cognitoSub}`,
          sk: `Goal#${goalId}`,
          __typename: 'Goal',
          tenantId: ctx.tenantId,
          userId: cognitoSub,
          goalId,
          objective: 'GROWTH',
          targetAmountCents: 500_000_00,
          createdAt: new Date().toISOString(),
        }],
      });

      // Subagent: verify exact query signature
      const result = await appsync.query<{
        getGoals: Array<{ goalId: string; objective: string }>;
      }>(`
        query GetGoals {
          getGoals { goalId objective }
        }
      `);

      expect(result.getGoals.length).toBeGreaterThanOrEqual(1);
      const goal = result.getGoals.find(g => g.goalId === goalId);
      expect(goal?.objective).toBe('GROWTH');
    }, 60_000);
  });

  // ── Event Materializations ──────────────────────────────────────────

  describe('event materializations', () => {
    it('should materialize BALANCE_UPDATED to profile balance', async () => {
      await eb.putEvent({
        bus: 'investor',
        targetService: 'investor-bff',
        detailType: 'BALANCE_UPDATED',
        detail: {
          cashBalanceCents: 500_000,
          totalValueCents: 750_000,
        },
      });

      // Verify DDB write — subagent must verify exact pk/sk from handler
      const item = await table.waitForItem({
        table: 'investor-bff',
        pk: `InvestorProfile#${ctx.tenantId}#${cognitoSub}`,
        timeoutMs: 60_000,
      });

      expect(item['tenantId']).toBe(ctx.tenantId);
    }, 120_000);
  });
});
```

**CRITICAL:** The subagent MUST read `services/investor/investor-bff/src/schema.graphql` to verify ALL mutation/query signatures, input types, and return types. The test code above uses placeholder signatures that need to be corrected. Also read the resolver code to understand exact DDB PK/SK patterns for seeded records.

- [ ] **Step 3: Run integration tests**

```bash
pnpm nx test-integration investor-bff
```

- [ ] **Step 4: Commit**

```bash
git add services/investor/investor-bff/test/integration/
git commit -m "feat(investor-bff): expand integration tests — mutations, queries, event materializations"
```

---

### Task 2: dashboard-bff — Expand Integration Tests (Read-Only Queries)

**Files:**
- Rewrite: `services/investor/dashboard-bff/test/integration/dashboard-bff.integration.test.ts`

**Context:** dashboard-bff is read-only (no mutations). It has:
- **Ingress events** (14): BALANCE_UPDATED, PORTFOLIO_UPDATED, RECONCILIATION_COMPLETED, DECISION_PACKET_CREATED, USER_CONFIRMATION_REQUESTED, DECISION_APPROVED, DECISION_BLOCKED, LEDGER_ENTRY_RECORDED, GOAL_CREATED, GOAL_UPDATED, RISK_PROFILE_CREATED, RISK_PROFILE_UPDATED, OPERATING_MODE_SELECTED, OPERATING_MODE_CHANGED → materialize to various DDB entities
- **Facade (AppSync)** with JS resolvers (queries only):
  - getDashboard, getPositionSnapshots, getRecentActivity, getTimeTravelAvailability, getSimulationSummary

DDB entities: `InvestorSnapshot` (pk: `T#{tenantId}`, sk: `InvestorSnapshot`), `PortfolioSummary` (pk: `T#{tenantId}`, sk: `PortfolioSummary`), `PositionSnapshot` (pk: `T#{tenantId}`, sk: `Position#{symbol}`), `RecentActivity` (pk: `T#{tenantId}`, sk: `Activity#{timestamp}`), `AdvisoryStatus` (pk: `T#{tenantId}`, sk: `AdvisoryStatus`).

Existing test covers GOAL_CREATED → InvestorSnapshot only.

- [ ] **Step 1: Read dashboard-bff schema, transforms, and resolvers**

Read:
- `services/investor/dashboard-bff/src/schema.graphql` — exact query signatures
- `services/investor/dashboard-bff/src/handlers/event-listener.ts` — transform routing
- `services/investor/dashboard-bff/src/resolvers/` — DDB query patterns

- [ ] **Step 2: Rewrite integration test**

Replace `services/investor/dashboard-bff/test/integration/dashboard-bff.integration.test.ts`:

```typescript
import {
  createIntegrationContext,
  EventBridgeClient,
  TableAssertions,
  DdbSeedFixture,
  CognitoFixture,
  AppSyncClient,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('dashboard-bff', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let table: TableAssertions;
  let seeder: DdbSeedFixture;
  let appsync: AppSyncClient;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();
    seeder = new DdbSeedFixture(ctx);

    const cognito = new CognitoFixture(ctx);
    const tokens = await cognito.setup();
    appsync = new AppSyncClient(ctx, tokens, 'dashboard-bff');
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  // ── Event Materializations ──────────────────────────────────────────

  describe('event materializations', () => {
    it('should materialize InvestorSnapshot on GOAL_CREATED', async () => {
      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'GOAL_CREATED',
        detail: {
          objective: 'GROWTH',
          targetAmountCents: 500_000_00,
          targetDate: '2030-01-01',
        },
      });

      const item = await table.waitForItem({
        table: 'dashboard-bff',
        pk: `T#${ctx.tenantId}`,
        sk: 'InvestorSnapshot',
        timeoutMs: 60_000,
      });

      expect(item['__typename']).toBe('InvestorSnapshot');
      expect(item['goalType']).toBe('GROWTH');
    }, 120_000);

    it('should materialize PortfolioSummary on BALANCE_UPDATED', async () => {
      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'BALANCE_UPDATED',
        detail: {
          cashBalanceCents: 500_000,
          totalValueCents: 750_000,
        },
      });

      const item = await table.waitForItem({
        table: 'dashboard-bff',
        pk: `T#${ctx.tenantId}`,
        sk: 'PortfolioSummary',
        timeoutMs: 60_000,
      });

      expect(item['__typename']).toBe('PortfolioSummary');
      expect(item['cashBalanceCents']).toBe(500_000);
    }, 120_000);

    it('should materialize PositionSnapshot on PORTFOLIO_UPDATED', async () => {
      const symbol = `TEST${Date.now()}`;

      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'PORTFOLIO_UPDATED',
        detail: {
          positions: {
            [symbol]: {
              symbol,
              quantity: 10,
              averageCostBasis: 150.0,
              totalCostBasis: 1500.0,
              lastFillPrice: 155.0,
            },
          },
        },
      });

      const item = await table.waitForItem({
        table: 'dashboard-bff',
        pk: `T#${ctx.tenantId}`,
        sk: `Position#${symbol}`,
        timeoutMs: 60_000,
      });

      expect(item['__typename']).toBe('PositionSnapshot');
      expect(item['symbol']).toBe(symbol);
      expect(item['quantity']).toBe(10);
    }, 120_000);

    it('should materialize RecentActivity on LEDGER_ENTRY_RECORDED', async () => {
      const timestamp = new Date().toISOString();

      await eb.putEvent({
        bus: 'investor',
        targetService: 'dashboard-bff',
        detailType: 'LEDGER_ENTRY_RECORDED',
        detail: {
          eventType: 'ORDER_FILLED',
          payload: { orderId: 'test-001', symbol: 'AAPL', quantity: 5 },
          timestamp,
        },
      });

      // Subagent: verify exact sk pattern from handler — may be Activity#{timestamp} or Activity#{eventId}
      const item = await table.waitForItem({
        table: 'dashboard-bff',
        pk: `T#${ctx.tenantId}`,
        timeoutMs: 60_000,
      });

      expect(item['tenantId']).toBe(ctx.tenantId);
    }, 120_000);
  });

  // ── AppSync Queries ─────────────────────────────────────────────────

  describe('AppSync queries', () => {
    it('should return dashboard data from getDashboard', async () => {
      // Pre-seed dashboard data
      await seeder.seed({
        table: 'dashboard-bff',
        items: [
          {
            pk: `T#${ctx.tenantId}`,
            sk: 'InvestorSnapshot',
            __typename: 'InvestorSnapshot',
            tenantId: ctx.tenantId,
            goalType: 'GROWTH',
            onboardedAt: new Date().toISOString(),
          },
          {
            pk: `T#${ctx.tenantId}`,
            sk: 'PortfolioSummary',
            __typename: 'PortfolioSummary',
            tenantId: ctx.tenantId,
            cashBalanceCents: 500_000,
            totalValueCents: 750_000,
          },
        ],
      });

      // Subagent: verify exact query signature from schema.graphql
      const result = await appsync.query<{
        getDashboard: { cashBalanceCents: number; totalValueCents: number };
      }>(`
        query GetDashboard {
          getDashboard { cashBalanceCents totalValueCents }
        }
      `);

      expect(result.getDashboard.cashBalanceCents).toBe(500_000);
    }, 60_000);

    it('should return positions from getPositionSnapshots', async () => {
      const symbol = `QUERY${Date.now()}`;

      await seeder.seed({
        table: 'dashboard-bff',
        items: [{
          pk: `T#${ctx.tenantId}`,
          sk: `Position#${symbol}`,
          __typename: 'PositionSnapshot',
          tenantId: ctx.tenantId,
          symbol,
          quantity: 25,
          averageCostBasis: 100.0,
        }],
      });

      // Subagent: verify exact query signature
      const result = await appsync.query<{
        getPositionSnapshots: Array<{ symbol: string; quantity: number }>;
      }>(`
        query GetPositionSnapshots {
          getPositionSnapshots { symbol quantity }
        }
      `);

      const found = result.getPositionSnapshots.find(p => p.symbol === symbol);
      expect(found?.quantity).toBe(25);
    }, 60_000);
  });
});
```

**Note:** The subagent MUST read `services/investor/dashboard-bff/src/schema.graphql` and the JS resolvers to verify ALL query signatures and DDB access patterns. The test code above uses estimated field names that need verification.

- [ ] **Step 3: Run integration tests**

```bash
pnpm nx test-integration dashboard-bff
```

- [ ] **Step 4: Commit**

```bash
git add services/investor/dashboard-bff/test/integration/
git commit -m "feat(dashboard-bff): expand integration tests — materializations + AppSync queries"
```

---

### Task 3: ledger-bff — Expand Integration Tests (Time-Travel Queries)

**Files:**
- Rewrite: `services/ledger/ledger-bff/test/integration/ledger-bff.integration.test.ts`

**Context:** ledger-bff has:
- **Ingress events** (3): BALANCE_UPDATED, PORTFOLIO_UPDATED, LEDGER_ENTRY_RECORDED → materialize to DDB
- **Facade (AppSync)** with both JS resolvers and Lambda resolvers:
  - JS resolvers: getBalance, getPortfolio, getPositions, getOrderHistory, getPerformance, getTimeTravelAvailability
  - Lambda resolvers: getPortfolioAt (time-travel), getSimulationComparison

DDB entities: `PortfolioBalance` (pk: `Portfolio#{tenantId}`, sk: `Balance`), `Position` (pk: `Portfolio#{tenantId}`, sk: `Position#{symbol}`), `HistoryEntry` (pk: `History#{tenantId}`, sk: `Entry#{sequenceNo}`).

Existing test covers 3 event materializations: BALANCE_UPDATED → PortfolioBalance, PORTFOLIO_UPDATED → Position, LEDGER_ENTRY_RECORDED → HistoryEntry. Add: AppSync queries with pre-seeded data.

- [ ] **Step 1: Read ledger-bff schema and resolvers**

Read:
- `services/ledger/ledger-bff/src/schema.graphql` — exact query signatures
- `services/ledger/ledger-bff/src/resolvers/` — JS resolver DDB patterns
- `services/ledger/ledger-bff/src/handlers/graphql-resolver.ts` — Lambda resolver logic for getPortfolioAt and getSimulationComparison

- [ ] **Step 2: Rewrite integration test**

Replace `services/ledger/ledger-bff/test/integration/ledger-bff.integration.test.ts`:

```typescript
import {
  createIntegrationContext,
  EventBridgeClient,
  TableAssertions,
  DdbSeedFixture,
  CognitoFixture,
  AppSyncClient,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('ledger-bff', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let table: TableAssertions;
  let seeder: DdbSeedFixture;
  let appsync: AppSyncClient;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();
    seeder = new DdbSeedFixture(ctx);

    const cognito = new CognitoFixture(ctx);
    const tokens = await cognito.setup();
    appsync = new AppSyncClient(ctx, tokens, 'ledger-bff');
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  // ── Event Materializations ──────────────────────────────────────────

  describe('event materializations', () => {
    it('should materialize BALANCE_UPDATED to PortfolioBalance', async () => {
      await eb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-bff',
        detailType: 'BALANCE_UPDATED',
        detail: {
          cashBalanceCents: 500_000,
          deltaCents: 50_000,
        },
      });

      const item = await table.waitForItem({
        table: 'ledger-bff',
        pk: `Portfolio#${ctx.tenantId}`,
        sk: 'Balance',
        timeoutMs: 60_000,
      });

      expect(item['__typename']).toBe('PortfolioBalance');
      expect(item['cashBalanceCents']).toBe(500_000);
    }, 120_000);

    it('should materialize PORTFOLIO_UPDATED to Position entries', async () => {
      const symbol = `TEST${Date.now()}`;

      await eb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-bff',
        detailType: 'PORTFOLIO_UPDATED',
        detail: {
          positions: {
            [symbol]: {
              symbol,
              quantity: 10,
              averageCostBasis: 150.0,
              totalCostBasis: 1500.0,
              lastFillPrice: 155.0,
            },
          },
        },
      });

      const item = await table.waitForItem({
        table: 'ledger-bff',
        pk: `Portfolio#${ctx.tenantId}`,
        sk: `Position#${symbol}`,
        timeoutMs: 60_000,
      });

      expect(item['__typename']).toBe('Position');
      expect(item['symbol']).toBe(symbol);
      expect(item['quantity']).toBe(10);
    }, 120_000);

    it('should materialize LEDGER_ENTRY_RECORDED to HistoryEntry', async () => {
      const sequenceNo = 1000 + Math.floor(Math.random() * 8000);
      const eventId = `integ-entry-${Date.now()}`;

      await eb.putEvent({
        bus: 'ledger',
        targetService: 'ledger-bff',
        detailType: 'LEDGER_ENTRY_RECORDED',
        detail: {
          eventId,
          eventType: 'ORDER_FILLED',
          payload: { orderId: 'test-order-001', symbol: 'AAPL', quantity: 5, fillPrice: 150.0 },
          timestamp: new Date().toISOString(),
          sequenceNo,
        },
      });

      const item = await table.waitForItem({
        table: 'ledger-bff',
        pk: `History#${ctx.tenantId}`,
        sk: `Entry#${sequenceNo}`,
        timeoutMs: 60_000,
      });

      expect(item['__typename']).toBe('HistoryEntry');
      expect(item['eventType']).toBe('ORDER_FILLED');
      expect(item['sequenceNo']).toBe(sequenceNo);
    }, 120_000);
  });

  // ── AppSync Queries ─────────────────────────────────────────────────

  describe('AppSync queries', () => {
    it('should return balance from getBalance', async () => {
      await seeder.seed({
        table: 'ledger-bff',
        items: [{
          pk: `Portfolio#${ctx.tenantId}`,
          sk: 'Balance',
          __typename: 'PortfolioBalance',
          tenantId: ctx.tenantId,
          cashBalanceCents: 1_000_000,
          deltaCents: 0,
          updatedAt: new Date().toISOString(),
        }],
      });

      // Subagent: verify exact query signature from schema.graphql
      const result = await appsync.query<{
        getBalance: { cashBalanceCents: number };
      }>(`
        query GetBalance {
          getBalance { cashBalanceCents }
        }
      `);

      expect(result.getBalance.cashBalanceCents).toBe(1_000_000);
    }, 60_000);

    it('should return positions from getPositions', async () => {
      const symbol = `QUERY${Date.now()}`;

      await seeder.seed({
        table: 'ledger-bff',
        items: [{
          pk: `Portfolio#${ctx.tenantId}`,
          sk: `Position#${symbol}`,
          __typename: 'Position',
          tenantId: ctx.tenantId,
          symbol,
          quantity: 15,
          averageCostBasis: 200.0,
          totalCostBasis: 3000.0,
          lastFillPrice: 210.0,
        }],
      });

      // Subagent: verify exact query signature
      const result = await appsync.query<{
        getPositions: Array<{ symbol: string; quantity: number }>;
      }>(`
        query GetPositions {
          getPositions { symbol quantity averageCostBasis }
        }
      `);

      const found = result.getPositions.find(p => p.symbol === symbol);
      expect(found?.quantity).toBe(15);
    }, 60_000);

    it('should return order history from getOrderHistory', async () => {
      const sequenceNo = 2000 + Math.floor(Math.random() * 7000);

      await seeder.seed({
        table: 'ledger-bff',
        items: [{
          pk: `History#${ctx.tenantId}`,
          sk: `Entry#${sequenceNo}`,
          __typename: 'HistoryEntry',
          tenantId: ctx.tenantId,
          eventType: 'ORDER_FILLED',
          eventId: `seed-${Date.now()}`,
          sequenceNo,
          timestamp: new Date().toISOString(),
          payload: { orderId: 'seed-order', symbol: 'AAPL', quantity: 5 },
        }],
      });

      // Subagent: verify exact query signature
      const result = await appsync.query<{
        getOrderHistory: Array<{ eventType: string; sequenceNo: number }>;
      }>(`
        query GetOrderHistory {
          getOrderHistory { eventType sequenceNo }
        }
      `);

      expect(result.getOrderHistory.length).toBeGreaterThanOrEqual(1);
    }, 60_000);

    it('should handle getPortfolioAt time-travel query (Lambda resolver)', async () => {
      // Pre-seed time-series data for time-travel
      const now = new Date();
      const pastTimestamp = new Date(now.getTime() - 3600_000).toISOString(); // 1 hour ago

      await seeder.seed({
        table: 'ledger-bff',
        items: [{
          pk: `Portfolio#${ctx.tenantId}`,
          sk: 'Balance',
          __typename: 'PortfolioBalance',
          tenantId: ctx.tenantId,
          cashBalanceCents: 1_000_000,
          updatedAt: pastTimestamp,
        }],
      });

      // Subagent: read graphql-resolver.ts to understand getPortfolioAt args and return type
      // This is a Lambda resolver (not JS resolver) that reconstructs portfolio state at a point in time
      const result = await appsync.query<{
        getPortfolioAt: { cashBalanceCents: number; timestamp: string };
      }>(`
        query GetPortfolioAt($timestamp: AWSDateTime!) {
          getPortfolioAt(timestamp: $timestamp) { cashBalanceCents timestamp }
        }
      `, { timestamp: pastTimestamp });

      expect(result.getPortfolioAt).toBeDefined();
    }, 60_000);
  });
});
```

**Note:** The subagent MUST read `services/ledger/ledger-bff/src/schema.graphql` and `services/ledger/ledger-bff/src/handlers/graphql-resolver.ts` to verify all query signatures, especially for the Lambda-backed resolvers (getPortfolioAt, getSimulationComparison). These may require specific input types or different return shapes.

- [ ] **Step 3: Run integration tests**

```bash
pnpm nx test-integration ledger-bff
```

- [ ] **Step 4: Commit**

```bash
git add services/ledger/ledger-bff/test/integration/
git commit -m "feat(ledger-bff): expand integration tests — AppSync queries + time-travel"
```

---

## Final Verification

After completing all 3 tasks, run the full integration test suite to verify nothing is broken:

```bash
pnpm nx run-many -t test-integration --all --parallel=4
```

Expected: All integration tests across all services pass.

---

## Plan Complete — All 4 Plans Finished

If all tests pass, the `feat/all-services-integration-tests` branch is ready for review and merge. The full test count should be ~85-101 integration tests across 16+ services.
