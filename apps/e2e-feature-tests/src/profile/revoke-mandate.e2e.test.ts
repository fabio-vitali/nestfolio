import {
  createTestContext,
  type TestContext,
} from '@nestfolio/test-support';
import { EventBusTrap } from '@nestfolio/integration-testing';
import { InvestorBffEventTypes } from '@nestfolio/investor-bff/events';
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
  let trap: EventBusTrap;

  beforeEach(async () => {
    ctx = await createTestContext();
    tenant = await freshTenant(ctx);
    // Arm BEFORE the fixture so we capture the Mandate row's INSERT-vs-MODIFY
    // CDC stream cleanly. We also include INVESTOR_PROFILE_UPDATED so we can later
    // assert that revoke does NOT emit that event (revoke targets the Mandate row
    // at sk='Mandate', not the InvestorProfile composite row).
    trap = new EventBusTrap(ctx);
    await trap.deploy({
      bus: 'investor',
      detailType: [
        InvestorBffEventTypes.MANDATE_REVOKED,
        InvestorBffEventTypes.INVESTOR_PROFILE_UPDATED,
      ],
    });
    await applyFixtures(ctx, tenant, [onboarded()]);
  }, 120_000);

  afterEach(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('revokeMandate returns Mandate row and emits MANDATE_REVOKED only', async () => {
    const bff = bffClient(ctx, tenant);

    // Drain any onboarding-driven INVESTOR_PROFILE_UPDATED events from the trap
    // BEFORE the revoke mutation so the post-mutation drain only contains the
    // events caused by revokeMandate itself.
    await trap.drain();

    const result = await bff.investor.mutate<{
      revokeMandate: {
        mandateId: string;
        level: string;
        status: 'ACTIVE' | 'REVOKED';
        effectiveDate: string;
        revokedAt: string | null;
      };
    }>(
      `mutation RevokeMandate {
         revokeMandate {
           mandateId
           level
           status
           effectiveDate
           revokedAt
         }
       }`,
      {},
    );

    expect(result.revokeMandate.status).toBe('REVOKED');
    expect(result.revokeMandate.mandateId).toBeTruthy();
    expect(result.revokeMandate.effectiveDate).toBeTruthy();
    expect(result.revokeMandate.revokedAt).toBeTruthy();
    expect(new Date(result.revokeMandate.revokedAt as string).toString()).not.toBe('Invalid Date');

    // Assert MANDATE_REVOKED event fires from the Mandate row's (sk='Mandate') modify CDC.
    const revoked = await trap.waitForEvent({
      detailType: InvestorBffEventTypes.MANDATE_REVOKED,
      timeoutMs: 60_000,
    });
    expect(revoked.detailType).toBe(InvestorBffEventTypes.MANDATE_REVOKED);

    // Assert NO INVESTOR_PROFILE_UPDATED event fires — revoke targets the
    // Mandate row (sk='Mandate') only, not the InvestorProfile composite row.
    const remaining = await trap.drain();
    const profileUpdates = remaining.filter(
      (e) => e.detailType === InvestorBffEventTypes.INVESTOR_PROFILE_UPDATED,
    );
    expect(profileUpdates).toHaveLength(0);
  });
});
