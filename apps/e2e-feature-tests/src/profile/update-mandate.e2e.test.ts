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

describe('scenario 4 — investor updates advisory mandate', () => {
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

  it('updateMandate persists new terms on the composite InvestorProfile.mandate', async () => {
    const bff = bffClient(ctx, tenant);

    // First updateMandate — set DISCRETIONARY with specific terms
    const first = await bff.investor.mutate<{
      updateMandate: {
        mandateId: string;
        level: string;
        status: string;
        monthlyTurnoverCapPercent: number;
        maxSingleTradePercent: number;
        rebalanceCadence: string;
        effectiveDate: string;
        revokedAt: string | null;
      };
    }>(
      `mutation UpdateMandate($input: MandateInput!) {
         updateMandate(input: $input) {
           mandateId
           level
           status
           monthlyTurnoverCapPercent
           maxSingleTradePercent
           rebalanceCadence
           effectiveDate
           revokedAt
         }
       }`,
      {
        input: {
          level: 'DISCRETIONARY',
          monthlyTurnoverCapPercent: 15,
          maxSingleTradePercent: 5,
          rebalanceCadence: 'MONTHLY',
        },
      },
    );
    expect(first.updateMandate.level).toBe('DISCRETIONARY');
    expect(first.updateMandate.rebalanceCadence).toBe('MONTHLY');
    expect(first.updateMandate.monthlyTurnoverCapPercent).toBe(15);
    expect(first.updateMandate.maxSingleTradePercent).toBe(5);
    expect(first.updateMandate.effectiveDate).toEqual(expect.any(String));
    expect(first.updateMandate.revokedAt).toBeNull();

    // Second updateMandate — different rebalance cadence proves repeatability
    const second = await bff.investor.mutate<{
      updateMandate: {
        mandateId: string;
        level: string;
        rebalanceCadence: string;
      };
    }>(
      `mutation UpdateMandate($input: MandateInput!) {
         updateMandate(input: $input) {
           mandateId
           level
           rebalanceCadence
         }
       }`,
      {
        input: {
          level: 'DISCRETIONARY',
          monthlyTurnoverCapPercent: 15,
          maxSingleTradePercent: 5,
          rebalanceCadence: 'QUARTERLY',
        },
      },
    );
    expect(second.updateMandate.rebalanceCadence).toBe('QUARTERLY');

    // Read back via the composite InvestorProfile.mandate to confirm persistence
    const readback = await waitForGraphQL<{
      getProfile: {
        mandate: {
          level: string;
          rebalanceCadence: string;
          monthlyTurnoverCapPercent: number;
        };
      };
    }>(
      bff.investor,
      `query Profile { getProfile { mandate { level rebalanceCadence monthlyTurnoverCapPercent } } }`,
      {},
      (r) => r.getProfile?.mandate?.rebalanceCadence === 'QUARTERLY',
      { timeoutMs: 60_000 },
    );
    expect(readback.getProfile.mandate.level).toBe('DISCRETIONARY');
    expect(readback.getProfile.mandate.monthlyTurnoverCapPercent).toBe(15);
  });
});
