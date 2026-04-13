import {
  createTestContext,
  type TestContext,
} from '@nestfolio/test-support';
import {
  freshTenant,
  applyFixtures,
  onboarded,
  bffClient,
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

  it('updateMandate returns the new terms and a second call creates a distinct mandate', async () => {
    const bff = bffClient(ctx, tenant);

    // First updateMandate — set DISCRETIONARY with specific terms
    const first = await bff.investor.mutate<{
      updateMandate: {
        mandateId: string;
        tenantId: string;
        level: string;
        monthlyTurnoverCapPercent: number;
        maxSingleTradePercent: number;
        coolDownDays: number;
        rebalanceCadence: string;
        effectiveDate: string;
        revokedAt: string | null;
        version: number;
      };
    }>(
      `mutation UpdateMandate($input: MandateInput!) {
         updateMandate(input: $input) {
           mandateId
           tenantId
           level
           monthlyTurnoverCapPercent
           maxSingleTradePercent
           coolDownDays
           rebalanceCadence
           effectiveDate
           revokedAt
           version
         }
       }`,
      {
        input: {
          level: 'DISCRETIONARY',
          monthlyTurnoverCapPercent: 15,
          maxSingleTradePercent: 5,
          coolDownDays: 2,
          rebalanceCadence: 'MONTHLY',
        },
      },
    );
    expect(first.updateMandate.level).toBe('DISCRETIONARY');
    expect(first.updateMandate.rebalanceCadence).toBe('MONTHLY');
    expect(first.updateMandate.monthlyTurnoverCapPercent).toBe(15);
    expect(first.updateMandate.maxSingleTradePercent).toBe(5);
    expect(first.updateMandate.coolDownDays).toBe(2);
    expect(first.updateMandate.effectiveDate).toEqual(expect.any(String));
    expect(first.updateMandate.revokedAt).toBeNull();
    expect(first.updateMandate.version).toBe(1);

    // Second updateMandate — different coolDownDays proves the operation is repeatable
    const second = await bff.investor.mutate<{
      updateMandate: {
        mandateId: string;
        level: string;
        coolDownDays: number;
        rebalanceCadence: string;
        version: number;
      };
    }>(
      `mutation UpdateMandate($input: MandateInput!) {
         updateMandate(input: $input) {
           mandateId
           level
           coolDownDays
           rebalanceCadence
           version
         }
       }`,
      {
        input: {
          level: 'DISCRETIONARY',
          monthlyTurnoverCapPercent: 15,
          maxSingleTradePercent: 5,
          coolDownDays: 3,
          rebalanceCadence: 'QUARTERLY',
        },
      },
    );
    // Each updateMandate creates a new record with a fresh mandateId
    expect(second.updateMandate.mandateId).not.toBe(first.updateMandate.mandateId);
    expect(second.updateMandate.coolDownDays).toBe(3);
    expect(second.updateMandate.rebalanceCadence).toBe('QUARTERLY');
  });
});
