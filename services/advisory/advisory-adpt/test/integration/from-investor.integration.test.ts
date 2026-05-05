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

  it('should forward INVESTOR_PROFILE_CREATED from InvestorBus to AdvisoryBus', async () => {
    const trap = new EventBusTrap(ctx);
    await trap.deploy({
      bus: 'advisory',
      detailType: 'INVESTOR_PROFILE_CREATED',
    });

    await eb.putEvent({
      bus: 'investor',
      targetService: 'advisory-adpt',
      detailType: 'INVESTOR_PROFILE_CREATED',
      detail: {
        investorProfileId: `integ-profile-${Date.now()}`,
      },
    });

    const event = await trap.waitForEvent<BusEventPayload>();
    expect(event.detailType).toBe('INVESTOR_PROFILE_CREATED');
    expect(event.detail.context.tenantId).toBe(ctx.tenantId);
  }, 60_000);

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

  it('should forward MANDATE_ACCEPTED from InvestorBus to AdvisoryBus', async () => {
    const trap = new EventBusTrap(ctx);
    await trap.deploy({
      bus: 'advisory',
      detailType: 'MANDATE_ACCEPTED',
    });

    await eb.putEvent({
      bus: 'investor',
      targetService: 'advisory-adpt',
      detailType: 'MANDATE_ACCEPTED',
      detail: {
        mandateId: `integ-mandate-${Date.now()}`,
      },
    });

    const event = await trap.waitForEvent<BusEventPayload>();
    expect(event.detailType).toBe('MANDATE_ACCEPTED');
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
});
