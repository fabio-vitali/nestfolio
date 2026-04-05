import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('investor-ctrl: ONBOARDING_COMPLETED notification', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);

    // Trap NOTIFICATION_CREATED on InvestorBus
    await trap.deploy({
      bus: 'investor',
      detailType: 'NOTIFICATION_CREATED',
    });
  }, 60_000);

  afterAll(async () => {
    // Clean up test data from DDB
    await table.cleanup({
      table: 'investor-ctrl',
      pk: `Notification#${ctx.tenantId}#${ctx.userId}`,
    });
    await ctx.cleanup.runAll();
  }, 30_000);

  it('should create welcome notification on ONBOARDING_COMPLETED', async () => {
    await eb.putEvent({
      bus: 'investor',
      targetService: 'investor-ctrl',
      detailType: 'ONBOARDING_COMPLETED',
      detail: {
        goal: 'RETIREMENT',
        riskTolerance: 'MODERATE',
      },
    });

    // Assert: Notification record in DDB
    const item = await table.waitForItem({
      table: 'investor-ctrl',
      pk: `Notification#${ctx.tenantId}#${ctx.userId}`,
    });
    expect(item['title']).toContain('Welcome');

    // Assert: CDC event emitted
    const event = await trap.waitForEvent();
    expect(event.detailType).toBe('NOTIFICATION_CREATED');
    expect(event.detail.context.tenantId).toBe(ctx.tenantId);
  }, 60_000);
});
