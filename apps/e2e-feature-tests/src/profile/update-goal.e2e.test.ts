import {
  createTestContext,
  type TestContext,
} from '@nestfolio/test-support';
import {
  freshTenant,
  applyFixtures,
  onboarded,
  bffClient,
  waitForGraphQL,
  type FreshTenant,
} from '..';

describe('scenario 3 — investor updates investment goal', () => {
  let ctx: TestContext;
  let tenant: FreshTenant;

  beforeEach(async () => {
    ctx = await createTestContext();
    tenant = await freshTenant(ctx);
    await applyFixtures(ctx, tenant, [onboarded()]);
  }, 120_000);

  afterEach(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('updateGoal reflects new values in getProfile.goal', async () => {
    const bff = bffClient(ctx, tenant);

    // Read the onboarded InvestorProfile to confirm Goal materialised on the
    // composite row before mutating.
    await waitForGraphQL<{
      getProfile: {
        tenantId: string;
        goal: {
          objective: string;
          targetAmountCents: number;
          currency: string;
          timeHorizonMonths: number;
          targetReturn: number;
        };
      };
    }>(
      bff.investor,
      `query Profile { getProfile { tenantId goal { objective targetAmountCents currency timeHorizonMonths targetReturn } } }`,
      {},
      (r) => !!r.getProfile?.goal?.objective,
      { timeoutMs: 90_000 },
    );

    // Mutate: update the goal with new values
    const mutation = await bff.investor.mutate<{
      updateGoal: { objective: string; targetAmountCents: number; timeHorizonMonths: number; targetReturn: number };
    }>(
      `mutation UpdateGoal($input: GoalInput!) {
         updateGoal(input: $input) {
           objective
           targetAmountCents
           currency
           timeHorizonMonths
           targetReturn
         }
       }`,
      {
        input: {
          objective: 'RETIREMENT',
          targetAmountCents: 10_000_000,
          currency: 'USD',
          timeHorizonMonths: 240,
          targetReturn: 0.065,
        },
      },
    );
    expect(mutation.updateGoal.objective).toBe('RETIREMENT');
    expect(mutation.updateGoal.targetAmountCents).toBe(10_000_000);

    // Read-back through the composite getProfile.goal to confirm persistence
    const readback = await waitForGraphQL<{
      getProfile: { goal: { objective: string; targetAmountCents: number } };
    }>(
      bff.investor,
      `query Profile { getProfile { goal { objective targetAmountCents } } }`,
      {},
      (r) => r.getProfile?.goal?.objective === 'RETIREMENT' && r.getProfile?.goal?.targetAmountCents === 10_000_000,
      { timeoutMs: 60_000 },
    );
    expect(readback.getProfile.goal.objective).toBe('RETIREMENT');
  });
});
