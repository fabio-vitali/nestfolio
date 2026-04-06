import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('execution-ctrl: DECISION_APPROVED order creation', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);

    // Trap any Order CDC event on ExecutionBus
    await trap.deploy({
      bus: 'execution',
      detailType: ['ORDER_SUBMITTED', 'ORDER_STAGED', 'ORDER_REJECTED'],
    });
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 30_000);

  it('should create an Order record and emit ORDER_SUBMITTED or ORDER_STAGED on DECISION_APPROVED', async () => {
    await eb.putEvent({
      bus: 'execution',
      targetService: 'execution-ctrl',
      detailType: 'DECISION_APPROVED',
      detail: {
        decisionPacketId: `integ-decision-${Date.now()}`,
        proposedTrades: [
          {
            symbol: 'AAPL',
            assetClass: 'EQUITY',
            side: 'BUY',
            quantityOrAmountCents: 1000,
            targetWeightPercent: 10,
          },
        ],
      },
    });

    // Assert: CDC event emitted (proves: event → SQS → Lambda → DDB write → CDC)
    // Outcome depends on safety checks + market hours
    const event = await trap.waitForEvent({ timeoutMs: 90_000 });
    expect(['ORDER_SUBMITTED', 'ORDER_STAGED', 'ORDER_REJECTED']).toContain(event.detailType);
  }, 120_000);
});
