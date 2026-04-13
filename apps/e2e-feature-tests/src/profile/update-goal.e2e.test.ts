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

  it('updateGoal reflects new values in getGoals', async () => {
    const bff = bffClient(ctx, tenant);

    // Read the onboarded Goal so we have its ID.
    const initial = await waitForGraphQL<{
      getGoals: Array<{
        goalId: string;
        tenantId: string;
        objective: string;
        targetAmountCents: number;
        currency: string;
        timeHorizonMonths: number;
        targetReturn: number;
      }>;
    }>(
      bff.investor,
      `query Goals { getGoals { goalId tenantId objective targetAmountCents currency timeHorizonMonths targetReturn } }`,
      {},
      (r) => r.getGoals.length >= 1,
      { timeoutMs: 90_000 },
    );
    const goalId = initial.getGoals[0].goalId;

    // Mutate: update the goal with new values
    const mutation = await bff.investor.mutate<{
      updateGoal: { goalId: string; objective: string; targetAmountCents: number; timeHorizonMonths: number; targetReturn: number };
    }>(
      `mutation UpdateGoal($goalId: ID!, $input: GoalInput!) {
         updateGoal(goalId: $goalId, input: $input) {
           goalId
           objective
           targetAmountCents
           currency
           timeHorizonMonths
           targetReturn
         }
       }`,
      {
        goalId,
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

    // Read-back through the list query to confirm persistence
    const readback = await waitForGraphQL<{
      getGoals: Array<{ goalId: string; objective: string; targetAmountCents: number }>;
    }>(
      bff.investor,
      `query Goals { getGoals { goalId objective targetAmountCents } }`,
      {},
      (r) => r.getGoals.some((g) => g.goalId === goalId && g.objective === 'RETIREMENT' && g.targetAmountCents === 10_000_000),
      { timeoutMs: 60_000 },
    );
    expect(readback.getGoals.find((g) => g.goalId === goalId)?.objective).toBe('RETIREMENT');
  });
});
