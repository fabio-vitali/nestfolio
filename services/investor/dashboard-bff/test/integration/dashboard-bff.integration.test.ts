import {
  createIntegrationContext,
  EventBridgeClient,
  TableAssertions,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('dashboard-bff: GOAL_CREATED → InvestorSnapshot DDB write', () => {
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

  it('should materialize InvestorSnapshot on GOAL_CREATED', async () => {
    // Put GOAL_CREATED event onto the investor bus targeting dashboard-bff
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

    // Verify: InvestorSnapshot written to DDB
    // pk: T#<tenantId>, sk: InvestorSnapshot
    const item = await table.waitForItem({
      table: 'dashboard-bff',
      pk: `T#${ctx.tenantId}`,
      sk: 'InvestorSnapshot',
      timeoutMs: 60_000,
    });

    expect(item['__typename']).toBe('InvestorSnapshot');
    expect(item['tenantId']).toBe(ctx.tenantId);
    expect(item['goalType']).toBe('GROWTH');
    expect(item['onboardedAt']).toBeDefined();
  }, 120_000);
});
