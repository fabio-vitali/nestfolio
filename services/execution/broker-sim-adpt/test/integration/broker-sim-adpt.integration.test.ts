import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('broker-sim-adpt: SIM_ORDER_REQUESTED fills order', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);

    // Trap SIM_ORDER_FILLED on ExecutionBus (emitted via CDC on VirtualTrade insert)
    await trap.deploy({
      bus: 'execution',
      detailType: 'SIM_ORDER_FILLED',
    });
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 30_000);

  it('should write VirtualTrade to DDB and emit SIM_ORDER_FILLED after SIM_ORDER_REQUESTED', async () => {
    const orderId = `test-order-${Date.now()}`;
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

    // Step 1: Verify DDB write (proves: event → SQS → Lambda → DDB VirtualTrade write)
    const item = await table.waitForItem({
      table: 'broker-sim-adpt',
      pk,
      sk: `Trade#${orderId}`,
      timeoutMs: 60_000,
    });
    expect(item['__typename']).toBe('VirtualTrade');
    expect(item['symbol']).toBe('VTI');

    // Step 2: Verify CDC event emitted (proves: DDB write → CDC → SIM_ORDER_FILLED on ExecutionBus)
    const event = await trap.waitForEvent({ timeoutMs: 30_000 });
    expect(event.detailType).toBe('SIM_ORDER_FILLED');
  }, 120_000);
});
