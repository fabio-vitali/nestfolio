import {
  createIntegrationContext,
  EventBridgeClient,
  TableAssertions,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('ledger-ctrl: ORDER_FILLED → LedgerEntry DDB write', () => {
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
    // pk pattern: Account#<tenantId>#actual, sk prefix: Event#
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
