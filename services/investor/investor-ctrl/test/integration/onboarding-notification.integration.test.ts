import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('investor-ctrl: ONBOARDING_COMPLETED notification', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);

    // Trap NOTIFICATION_CREATED on InvestorBus
    await trap.deploy({
      bus: 'investor',
      detailType: 'NOTIFICATION_CREATED',
    });
  }, 60_000);

  afterAll(async () => {
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

    // Assert: CDC event emitted (proves: event → SQS → Lambda → DDB write → CDC)
    const event = await trap.waitForEvent({ timeoutMs: 90_000 });
    expect(event.detailType).toBe('NOTIFICATION_CREATED');
  }, 120_000);
});
