import {
  createTestContext,
  type TestContext,
} from '@nestfolio/test-support';
import {
  freshTenant,
  applyFixtures,
  onboarded,
  withLiveDecision,
  type FreshTenant,
} from '..';

describe('scenario 11 — investor sees first advisory decision after onboarding (live AgentCore pipeline)', () => {
  let ctx: TestContext;
  let tenant: FreshTenant;

  beforeEach(async () => {
    ctx = await createTestContext();
    tenant = await freshTenant(ctx);
    await applyFixtures(ctx, tenant, [onboarded()]);
  }, 180_000);

  afterEach(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('MANDATE_CREATED drives the live advisory cycle through AgentCore and surfaces a decision', async () => {
    const result = await applyFixtures(ctx, tenant, [
      withLiveDecision({ trigger: 'MANDATE_CREATED' }),
    ]);

    expect(result['decisionId']).toEqual(expect.any(String));
    expect(result['pipelineMetadata']).toMatchObject({
      trigger: expect.any(String),
      status: expect.any(String),
    });
  }, 240_000);
});
