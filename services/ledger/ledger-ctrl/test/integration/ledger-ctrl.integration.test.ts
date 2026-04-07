import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  AccountSeedingFixture,
  TableAssertions,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

// ── Helper: wait for a LedgerEntry with a specific eventType ──────────

async function waitForLedgerEntry(
  table: TableAssertions,
  tenantId: string,
  eventType: string,
  timeoutMs = 60_000,
  pollIntervalMs = 3_000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  const pk = `Account#${tenantId}#actual`;

  while (Date.now() < deadline) {
    const items = await table.queryItems({
      table: 'ledger-ctrl',
      pk,
      skPrefix: 'Event#',
    });
    const match = items.find(
      (i) => i['__typename'] === 'LedgerEntry' && i['eventType'] === eventType,
    );
    if (match) return match;
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  throw new Error(
    `waitForLedgerEntry: timeout waiting for eventType=${eventType} after ${timeoutMs}ms`,
  );
}

// ── Smoke: ORDER_FILLED → LedgerEntry DDB write ───────────────────────

describe('ledger-ctrl: ORDER_FILLED → LedgerEntry DDB write (smoke)', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 30_000);

  it('should record a LedgerEntry on ORDER_FILLED', async () => {
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'ORDER_FILLED',
      detail: {
        orderId: 'test-order-integ-001',
        symbol: 'AAPL',
        side: 'BUY',
        quantity: 10,
        fillPrice: 150.0,
        filledAt: new Date().toISOString(),
        executionMode: 'paper',
      },
    });

    const item = await table.waitForItem({
      table: 'ledger-ctrl',
      pk: `Account#${ctx.tenantId}#actual`,
      timeoutMs: 60_000,
    });

    expect(item['__typename']).toBe('LedgerEntry');
    expect(item['tenantId']).toBe(ctx.tenantId);
    expect(item['eventType']).toBe('ORDER_FILLED');
  }, 120_000);
});

// ── DDB write coverage: each event type creates a LedgerEntry ─────────

describe('ledger-ctrl: event-listener DDB writes', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 30_000);

  it('should record a LedgerEntry on DEPOSIT_DETECTED', async () => {
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'DEPOSIT_DETECTED',
      detail: {
        depositId: `dep-ddb-${Date.now()}`,
        amountCents: 500_000,
        depositedAt: new Date().toISOString(),
      },
    });

    const item = await waitForLedgerEntry(table, ctx.tenantId, 'DEPOSIT_DETECTED');
    expect(item['__typename']).toBe('LedgerEntry');
    expect(item['tenantId']).toBe(ctx.tenantId);
  }, 120_000);

  it('should record a LedgerEntry on WITHDRAWAL_COMPLETED', async () => {
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'WITHDRAWAL_COMPLETED',
      detail: {
        withdrawalId: `wd-ddb-${Date.now()}`,
        amountCents: 100_000,
        completedAt: new Date().toISOString(),
      },
    });

    const item = await waitForLedgerEntry(table, ctx.tenantId, 'WITHDRAWAL_COMPLETED');
    expect(item['__typename']).toBe('LedgerEntry');
    expect(item['tenantId']).toBe(ctx.tenantId);
  }, 120_000);

  it('should record a LedgerEntry on ORDER_PARTIALLY_FILLED', async () => {
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'ORDER_PARTIALLY_FILLED',
      detail: {
        orderId: `partial-ddb-${Date.now()}`,
        symbol: 'MSFT',
        side: 'BUY',
        quantity: 3,
        fillPrice: 420.0,
        filledAt: new Date().toISOString(),
        executionMode: 'paper',
      },
    });

    const item = await waitForLedgerEntry(table, ctx.tenantId, 'ORDER_PARTIALLY_FILLED');
    expect(item['__typename']).toBe('LedgerEntry');
    expect(item['tenantId']).toBe(ctx.tenantId);
  }, 120_000);

  it('should record a LedgerEntry on ORDER_REJECTED', async () => {
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'ORDER_REJECTED',
      detail: {
        orderId: `reject-ddb-${Date.now()}`,
        symbol: 'TSLA',
        side: 'BUY',
        quantity: 5,
        reason: 'Insufficient margin',
        rejectedAt: new Date().toISOString(),
      },
    });

    const item = await waitForLedgerEntry(table, ctx.tenantId, 'ORDER_REJECTED');
    expect(item['__typename']).toBe('LedgerEntry');
    expect(item['tenantId']).toBe(ctx.tenantId);
  }, 120_000);

  it('should record a LedgerEntry on ORDER_CANCELLED', async () => {
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'ORDER_CANCELLED',
      detail: {
        orderId: `cancel-ddb-${Date.now()}`,
        symbol: 'GOOG',
        side: 'SELL',
        quantity: 2,
        cancelledAt: new Date().toISOString(),
      },
    });

    const item = await waitForLedgerEntry(table, ctx.tenantId, 'ORDER_CANCELLED');
    expect(item['__typename']).toBe('LedgerEntry');
    expect(item['tenantId']).toBe(ctx.tenantId);
  }, 120_000);
});

// ── CDC chain: ORDER_FILLED → BALANCE_UPDATED ─────────────────────────

describe('ledger-ctrl: ORDER_FILLED → full CDC chain', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let seeder: AccountSeedingFixture;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    seeder = new AccountSeedingFixture(ctx);

    // Seed initial account state so Reducer has prior state to delta against
    await seeder.seed('ledger-ctrl');

    // Trap the CDC output
    await trap.deploy({ bus: 'ledger', detailType: 'BALANCE_UPDATED' });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('should emit BALANCE_UPDATED via Reducer CDC chain', async () => {
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'ORDER_FILLED',
      detail: {
        orderId: `fill-cdc-${Date.now()}`,
        symbol: 'AAPL',
        side: 'BUY',
        quantity: 10,
        fillPrice: 150.0,
        filledAt: new Date().toISOString(),
        executionMode: 'paper',
      },
    });

    const event = await trap.waitForEvent({ timeoutMs: 90_000 });
    expect(event.detailType).toBe('BALANCE_UPDATED');
    expect((event.detail as any).context.tenantId).toBe(ctx.tenantId);
  }, 120_000);
});

// ── CDC chain: DEPOSIT_DETECTED → BALANCE_UPDATED ─────────────────────

describe('ledger-ctrl: DEPOSIT_DETECTED → full CDC chain', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let seeder: AccountSeedingFixture;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    seeder = new AccountSeedingFixture(ctx);

    await seeder.seed('ledger-ctrl');
    await trap.deploy({ bus: 'ledger', detailType: 'BALANCE_UPDATED' });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('should emit BALANCE_UPDATED on deposit', async () => {
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'DEPOSIT_DETECTED',
      detail: {
        depositId: `dep-cdc-${Date.now()}`,
        amountCents: 500_000,
        depositedAt: new Date().toISOString(),
      },
    });

    const event = await trap.waitForEvent({ timeoutMs: 90_000 });
    expect(event.detailType).toBe('BALANCE_UPDATED');
    expect((event.detail as any).context.tenantId).toBe(ctx.tenantId);
  }, 120_000);
});

// ── CDC chain: WITHDRAWAL_COMPLETED → BALANCE_UPDATED ─────────────────

describe('ledger-ctrl: WITHDRAWAL_COMPLETED → full CDC chain', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let seeder: AccountSeedingFixture;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    seeder = new AccountSeedingFixture(ctx);

    // Seed with enough cash for withdrawal
    await seeder.seed('ledger-ctrl', { cashBalanceCents: 2_000_000 });
    await trap.deploy({ bus: 'ledger', detailType: 'BALANCE_UPDATED' });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('should emit BALANCE_UPDATED on withdrawal', async () => {
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'WITHDRAWAL_COMPLETED',
      detail: {
        withdrawalId: `wd-cdc-${Date.now()}`,
        amountCents: 100_000,
        completedAt: new Date().toISOString(),
      },
    });

    const event = await trap.waitForEvent({ timeoutMs: 90_000 });
    expect(event.detailType).toBe('BALANCE_UPDATED');
    expect((event.detail as any).context.tenantId).toBe(ctx.tenantId);
  }, 120_000);
});

// ── CDC chain: ORDER_PARTIALLY_FILLED → BALANCE_UPDATED ───────────────

describe('ledger-ctrl: ORDER_PARTIALLY_FILLED → full CDC chain', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let seeder: AccountSeedingFixture;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    seeder = new AccountSeedingFixture(ctx);

    await seeder.seed('ledger-ctrl');
    await trap.deploy({ bus: 'ledger', detailType: 'BALANCE_UPDATED' });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('should emit BALANCE_UPDATED on partial fill', async () => {
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'ORDER_PARTIALLY_FILLED',
      detail: {
        orderId: `partial-cdc-${Date.now()}`,
        symbol: 'MSFT',
        side: 'BUY',
        quantity: 3,
        fillPrice: 420.0,
        filledAt: new Date().toISOString(),
        executionMode: 'paper',
      },
    });

    const event = await trap.waitForEvent({ timeoutMs: 90_000 });
    expect(event.detailType).toBe('BALANCE_UPDATED');
    expect((event.detail as any).context.tenantId).toBe(ctx.tenantId);
  }, 120_000);
});

// ── CDC chain: ORDER_REJECTED → LEDGER_ENTRY_RECORDED ─────────────────

describe('ledger-ctrl: ORDER_REJECTED → full CDC chain', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let seeder: AccountSeedingFixture;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    seeder = new AccountSeedingFixture(ctx);

    await seeder.seed('ledger-ctrl');
    // ORDER_REJECTED is a no-op in the reducer — no balance/portfolio change.
    // But LedgerEntryEvent is always written → LEDGER_ENTRY_RECORDED.
    await trap.deploy({ bus: 'ledger', detailType: 'LEDGER_ENTRY_RECORDED' });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('should emit LEDGER_ENTRY_RECORDED on rejection', async () => {
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'ORDER_REJECTED',
      detail: {
        orderId: `reject-cdc-${Date.now()}`,
        symbol: 'TSLA',
        side: 'BUY',
        quantity: 5,
        reason: 'Insufficient margin',
        rejectedAt: new Date().toISOString(),
      },
    });

    const event = await trap.waitForEvent({ timeoutMs: 90_000 });
    expect(event.detailType).toBe('LEDGER_ENTRY_RECORDED');
    expect((event.detail as any).context.tenantId).toBe(ctx.tenantId);
  }, 120_000);
});
