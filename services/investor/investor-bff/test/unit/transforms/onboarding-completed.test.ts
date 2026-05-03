import { onboardingCompleted } from '../../../src/transforms/onboarding-completed';
import { InvestorProfileRepository } from '../../../src/repositories/investor-profile.repository';

jest.mock('../../../src/repositories/investor-profile.repository');

describe('onboardingCompleted transform', () => {
  const baseSubject = {
    tenantId: 't1',
    userId: 'u1',
    email: 'u1@example.com',
    goal: { objective: 'RETIREMENT' },
    horizonYears: 20,
    accountMode: 'simulation',
    capitalAmount: 100000,
    currency: 'EUR',
    riskTolerance: 3,
    riskExperience: 2,
    operatingMode: 'BALANCED',
    mandateAccepted: true as const,
  };
  const ctx = { region: 'us-east-1', tenantId: 't1', userId: 'u1', eventId: 'e1', eventType: 'ONBOARDING_COMPLETED', timestamp: '2026-05-03T00:00:00Z' };

  beforeEach(() => {
    (InvestorProfileRepository as jest.MockedClass<typeof InvestorProfileRepository>).prototype.transactWrite = jest.fn().mockResolvedValue(undefined);
    process.env.TABLE_NAME = 'test-table';
  });

  it('writes InvestorProfile composite row with nested goal, riskProfile, mandate', async () => {
    await onboardingCompleted({ subject: baseSubject } as any, ctx as any);
    const call = (InvestorProfileRepository as any).prototype.transactWrite.mock.calls[0][0];
    const profileItem = call.TransactItems[0].Put.Item;
    expect(profileItem.sk).toBe('InvestorProfile');
    expect(profileItem.__typename).toBe('InvestorProfile');
    expect(profileItem.goal).toMatchObject({ objective: 'RETIREMENT', timeHorizonMonths: 240, currency: 'EUR' });
    expect(profileItem.riskProfile).toMatchObject({ score: expect.any(Number), band: expect.any(Object) });
    expect(profileItem.mandate).toMatchObject({ level: expect.any(String), status: 'ACTIVE' });
    expect(profileItem.accountMode).toMatchObject({ mode: 'simulation', capitalAmount: 100000, currency: 'EUR' });
    expect(profileItem.operatingMode).toBe('BALANCED');
  });

  it('writes MandateStatus sibling row with status=ACCEPTED', async () => {
    await onboardingCompleted({ subject: baseSubject } as any, ctx as any);
    const call = (InvestorProfileRepository as any).prototype.transactWrite.mock.calls[0][0];
    const statusItem = call.TransactItems[1].Put.Item;
    expect(statusItem.sk).toBe('MandateStatus');
    expect(statusItem.__typename).toBe('MandateStatus');
    expect(statusItem.status).toBe('ACCEPTED');
    expect(statusItem.acceptedAt).toBeTruthy();
    expect(statusItem.revokedAt).toBeNull();
  });

  it('appends Deposit row when capitalAmount > 0', async () => {
    await onboardingCompleted({ subject: baseSubject } as any, ctx as any);
    const call = (InvestorProfileRepository as any).prototype.transactWrite.mock.calls[0][0];
    expect(call.TransactItems).toHaveLength(3);
    expect(call.TransactItems[2].Put.Item.__typename).toBe('Deposit');
  });

  it('omits Deposit row when capitalAmount === 0', async () => {
    await onboardingCompleted({ subject: { ...baseSubject, capitalAmount: 0 } } as any, ctx as any);
    const call = (InvestorProfileRepository as any).prototype.transactWrite.mock.calls[0][0];
    expect(call.TransactItems).toHaveLength(2);
  });

  it('e2e tenants get ADVISORY mandate level by default', async () => {
    await onboardingCompleted({ subject: { ...baseSubject, tenantId: 'e2e-t1' } } as any, ctx as any);
    const call = (InvestorProfileRepository as any).prototype.transactWrite.mock.calls[0][0];
    expect(call.TransactItems[0].Put.Item.mandate.level).toBe('ADVISORY');
  });

  it('production tenants get DISCRETIONARY mandate level by default', async () => {
    await onboardingCompleted({ subject: baseSubject } as any, ctx as any);
    const call = (InvestorProfileRepository as any).prototype.transactWrite.mock.calls[0][0];
    expect(call.TransactItems[0].Put.Item.mandate.level).toBe('DISCRETIONARY');
  });

  it('mandateLevel override on payload wins over default', async () => {
    await onboardingCompleted({ subject: { ...baseSubject, tenantId: 'e2e-t1', mandateLevel: 'DISCRETIONARY' } } as any, ctx as any);
    const call = (InvestorProfileRepository as any).prototype.transactWrite.mock.calls[0][0];
    expect(call.TransactItems[0].Put.Item.mandate.level).toBe('DISCRETIONARY');
  });
});
