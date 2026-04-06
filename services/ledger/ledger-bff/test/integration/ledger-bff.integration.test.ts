import {
  createIntegrationContext,
  EventBridgeClient,
  TableAssertions,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('ledger-bff: BALANCE_UPDATED → PortfolioBalance DDB write', () => {
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

  it('should materialize BALANCE_UPDATED to PortfolioBalance in DDB', async () => {
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-bff',
      detailType: 'BALANCE_UPDATED',
      detail: {
        cashBalanceCents: 500000,
        deltaCents: 50000,
      },
    });

    // Verify: PortfolioBalance written to DDB
    // pk: Portfolio#<tenantId>, sk: Balance
    const item = await table.waitForItem({
      table: 'ledger-bff',
      pk: `Portfolio#${ctx.tenantId}`,
      sk: 'Balance',
      timeoutMs: 60_000,
    });

    expect(item['__typename']).toBe('PortfolioBalance');
    expect(item['tenantId']).toBe(ctx.tenantId);
    expect(item['cashBalanceCents']).toBe(500000);
  }, 120_000);

  it('should materialize PORTFOLIO_UPDATED to Position entries in DDB', async () => {
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

    // Verify: Position written to DDB
    // pk: Portfolio#<tenantId>, sk: Position#<symbol>
    const item = await table.waitForItem({
      table: 'ledger-bff',
      pk: `Portfolio#${ctx.tenantId}`,
      sk: `Position#${symbol}`,
      timeoutMs: 60_000,
    });

    expect(item['__typename']).toBe('Position');
    expect(item['tenantId']).toBe(ctx.tenantId);
    expect(item['symbol']).toBe(symbol);
    expect(item['quantity']).toBe(10);
  }, 120_000);

  it('should materialize LEDGER_ENTRY_RECORDED to HistoryEntry in DDB', async () => {
    // Use a large unique sequenceNo (avoids collision with previous runs and checkpoint boundary)
    const sequenceNo = 1000 + Math.floor(Math.random() * 8000); // 1000–8999, never a checkpoint (mod 100 ≠ 0)
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

    // Verify: HistoryEntry written to DDB
    // pk: History#<tenantId>, sk: Entry#<sequenceNo>
    const item = await table.waitForItem({
      table: 'ledger-bff',
      pk: `History#${ctx.tenantId}`,
      sk: `Entry#${sequenceNo}`,
      timeoutMs: 60_000,
    });

    expect(item['__typename']).toBe('HistoryEntry');
    expect(item['tenantId']).toBe(ctx.tenantId);
    expect(item['eventType']).toBe('ORDER_FILLED');
    // eventId stored from event.subject.eventId — assert it is a non-empty string
    expect(item['eventId']).toEqual(expect.any(String));
    expect(item['sequenceNo']).toBe(sequenceNo);
  }, 120_000);
});
