import {
  createIntegrationContext,
  EventBridgeClient,
  TableAssertions,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('advisory-bff: DECISION_PACKET_CREATED → DecisionSummary DDB write', () => {
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

  it('should materialize DecisionSummary to DDB', async () => {
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'advisory-bff',
      detailType: 'DECISION_PACKET_CREATED',
      detail: {
        tenantId: ctx.tenantId,
        decisionId: `integ-decision-${Date.now()}`,
        trigger: 'REBALANCE',
        proposedTrades: [{ symbol: 'AAPL', action: 'BUY', quantity: 10 }],
        explanation: 'Integration test decision',
        confirmationRequired: true,
      },
    });

    // record('DecisionSummary', ...) without key overrides → pk: T#<tenantId>, sk: DecisionSummary#<eventId>
    const item = await table.waitForItem({
      table: 'advisory-bff',
      pk: `T#${ctx.tenantId}`,
      timeoutMs: 60_000,
    });

    expect(item['__typename']).toBe('DecisionSummary');
    expect(item['tenantId']).toBe(ctx.tenantId);
    expect(item['trigger']).toBe('REBALANCE');
  }, 120_000);
});
