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

describe('scenario 5 — investor revokes advisory mandate', () => {
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

  it('revokeMandate returns a mandate with revokedAt set', async () => {
    const bff = bffClient(ctx, tenant);

    const result = await bff.investor.mutate<{
      revokeMandate: {
        mandateId: string;
        tenantId: string;
        level: string;
        revokedAt: string | null;
        effectiveDate: string;
        version: number;
      };
    }>(
      `mutation RevokeMandate {
         revokeMandate {
           mandateId
           tenantId
           level
           revokedAt
           effectiveDate
           version
         }
       }`,
      {},
    );

    expect(result.revokeMandate.mandateId).toBeTruthy();
    expect(result.revokeMandate.tenantId).toBe(tenant.tenantId);
    expect(result.revokeMandate.revokedAt).toBeTruthy();
    expect(new Date(result.revokeMandate.revokedAt as string).toString()).not.toBe('Invalid Date');
    expect(result.revokeMandate.effectiveDate).toBeTruthy();
  });
});
