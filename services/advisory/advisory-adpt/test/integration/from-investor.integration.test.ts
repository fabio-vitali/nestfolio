import {
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
  createIntegrationTestContext,
  EventBusTrap,
  type BusEventPayload,
} from '@nestfolio/integration-testing';

describe('advisory-adpt: Investor → Advisory forwarding', () => {
  let ctx: TestContext;
  let eb: EventBridgeClient;

  beforeAll(async () => {
    ctx = await createIntegrationTestContext();
    eb = new EventBridgeClient(ctx);
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 30_000);

  it('should forward INVESTOR_PROFILE_UPDATED from InvestorBus to AdvisoryBus', async () => {
    const trap = new EventBusTrap(ctx);
    await trap.deploy({
      bus: 'advisory',
      detailType: 'INVESTOR_PROFILE_UPDATED',
    });

    await eb.putEvent({
      bus: 'investor',
      targetService: 'advisory-adpt',
      detailType: 'INVESTOR_PROFILE_UPDATED',
      detail: {
        investorProfileId: `integ-profile-${Date.now()}`,
      },
    });

    const event = await trap.waitForEvent<BusEventPayload>();
    expect(event.detailType).toBe('INVESTOR_PROFILE_UPDATED');
    expect(event.detail.context.tenantId).toBe(ctx.tenantId);
  }, 60_000);

  it('should forward MANDATE_ISSUED from InvestorBus to AdvisoryBus', async () => {
    const trap = new EventBusTrap(ctx);
    await trap.deploy({
      bus: 'advisory',
      detailType: 'MANDATE_ISSUED',
    });

    await eb.putEvent({
      bus: 'investor',
      targetService: 'advisory-adpt',
      detailType: 'MANDATE_ISSUED',
      detail: {
        mandateId: `integ-mandate-${Date.now()}`,
      },
    });

    const event = await trap.waitForEvent<BusEventPayload>();
    expect(event.detailType).toBe('MANDATE_ISSUED');
    expect(event.detail.context.tenantId).toBe(ctx.tenantId);
  }, 60_000);

  it('should forward MANDATE_REVOKED from InvestorBus to AdvisoryBus', async () => {
    const trap = new EventBusTrap(ctx);
    await trap.deploy({
      bus: 'advisory',
      detailType: 'MANDATE_REVOKED',
    });

    await eb.putEvent({
      bus: 'investor',
      targetService: 'advisory-adpt',
      detailType: 'MANDATE_REVOKED',
      detail: {
        mandateId: `integ-mandate-${Date.now()}`,
      },
    });

    const event = await trap.waitForEvent<BusEventPayload>();
    expect(event.detailType).toBe('MANDATE_REVOKED');
    expect(event.detail.context.tenantId).toBe(ctx.tenantId);
  }, 60_000);

  it('should forward OPERATING_MODE_CHANGED from InvestorBus to AdvisoryBus', async () => {
    const trap = new EventBusTrap(ctx);
    await trap.deploy({
      bus: 'advisory',
      detailType: 'OPERATING_MODE_CHANGED',
    });

    await eb.putEvent({
      bus: 'investor',
      targetService: 'advisory-adpt',
      detailType: 'OPERATING_MODE_CHANGED',
      detail: {
        operatingMode: 'AGGRESSIVE',
      },
    });

    const event = await trap.waitForEvent<BusEventPayload>();
    expect(event.detailType).toBe('OPERATING_MODE_CHANGED');
    expect(event.detail.context.tenantId).toBe(ctx.tenantId);
  }, 60_000);
});
