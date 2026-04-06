import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  AccountSeedingFixture,
  TableAssertions,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('ledger-ctrl: ORDER_FILLED → LedgerEntry DDB write (smoke)', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    table = new TableAssertions(ctx);
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

    // Verify: LedgerEntry written to DDB (proves event→SQS→Lambda→DDB path)
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
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 30_000);

  it('should emit BALANCE_UPDATED via full Reducer CDC chain', async () => {
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'ORDER_FILLED',
      detail: {
        orderId: 'full-cdc-test',
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
