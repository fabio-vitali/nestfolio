import {
  createTestContext,
  type TestContext,
} from '@nestfolio/test-support';
import {
  freshTenant,
  applyFixtures,
  onboarded,
  funded,
  bffClient,
  type FreshTenant,
} from '..';

describe('scenario 10 — investor requests account closure', () => {
  let ctx: TestContext;
  let tenant: FreshTenant;

  beforeEach(async () => {
    ctx = await createTestContext();
    tenant = await freshTenant(ctx);
    await applyFixtures(ctx, tenant, [
      onboarded(),
      funded({ cashBalanceCents: 500_000 }),
    ]);
  }, 600_000);

  afterEach(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('requestAccountClosure returns a closure request with a timestamp', async () => {
    const bff = bffClient(ctx, tenant);

    const closure = await bff.investor.mutate<{
      requestAccountClosure: { closureId: string; status: string; requestedAt: string };
    }>(
      `mutation RequestClosure { requestAccountClosure { closureId status requestedAt } }`,
      {},
    );

    expect(closure.requestAccountClosure.closureId).toBeTruthy();
    expect(closure.requestAccountClosure.status).toBe('REQUESTED');
    expect(new Date(closure.requestAccountClosure.requestedAt).toString()).not.toBe('Invalid Date');
  });
});
