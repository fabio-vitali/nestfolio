import { onboardingCompleted } from '../../../src/transforms/onboarding-completed';
import { InvestorProfileRepository } from '../../../src/repositories/investor-profile.repository';

jest.mock('../../../src/repositories/investor-profile.repository');

describe('onboardingCompleted transform', () => {
  const baseSubject = {
    tenantId: 't1', userId: 'u1', email: 'u1@example.com',
    goal: { objective: 'RETIREMENT' }, horizonYears: 20,
    accountMode: 'simulation' as const, capitalAmount: 100000, currency: 'EUR',
    riskTolerance: 3, riskExperience: 2,
    operatingMode: 'BALANCED' as const, mandateAccepted: true as const,
  };
  const ctx = { region: 'us-east-1', tenantId: 't1', userId: 'u1', eventId: 'e1',
                eventType: 'ONBOARDING_COMPLETED', timestamp: '2026-05-08T00:00:00Z' };

  beforeEach(() => {
    (InvestorProfileRepository as jest.MockedClass<typeof InvestorProfileRepository>).prototype.transactWrite =
      jest.fn().mockResolvedValue(undefined);
    process.env.TABLE_NAME = 'test-table';
  });

  it('writes InvestorProfile row sans nested mandate guardrails', async () => {
    await onboardingCompleted({ subject: baseSubject } as any, ctx as any);
    const items = (InvestorProfileRepository as any).prototype.transactWrite.mock.calls[0][0].TransactItems;
    const profile = items.find((i: any) => i.Put?.Item.sk === 'InvestorProfile').Put.Item;
    expect(profile.operatingMode).toBe('BALANCED');
    expect(profile.mandateLevel).toBe('DISCRETIONARY'); // tenantId 't1' lacks 'e2e-' prefix → default DISCRETIONARY
    expect(profile.mandate).toBeUndefined(); // numeric guardrails no longer nested
    expect(profile.mandateId).toEqual(expect.any(String));
  });

  it('stamps __version: 1 on the seeded InvestorProfile row', async () => {
    await onboardingCompleted({ subject: baseSubject } as any, ctx as any);
    const items = (InvestorProfileRepository as any).prototype.transactWrite.mock.calls[0][0].TransactItems;
    const profile = items.find((i: any) => i.Put?.Item.sk === 'InvestorProfile').Put.Item;
    expect(profile.__version).toBe(1);
  });

  it('writes a sibling Mandate row with status=ACTIVE and operatingMode denormalized', async () => {
    await onboardingCompleted({ subject: baseSubject } as any, ctx as any);
    const items = (InvestorProfileRepository as any).prototype.transactWrite.mock.calls[0][0].TransactItems;
    const mandate = items.find((i: any) => i.Put?.Item.sk === 'Mandate').Put.Item;
    expect(mandate).toMatchObject({
      __typename: 'Mandate',
      tenantId: 't1', userId: 'u1',
      status: 'ACTIVE',
      revokedAt: null,
      level: 'DISCRETIONARY',
      operatingMode: 'BALANCED', // denormalized so MANDATE_ISSUED carries it for compliance projection
    });
    expect(mandate.mandateId).toEqual(expect.any(String));
  });

  it('does NOT write a MandateStatus row anymore', async () => {
    await onboardingCompleted({ subject: baseSubject } as any, ctx as any);
    const items = (InvestorProfileRepository as any).prototype.transactWrite.mock.calls[0][0].TransactItems;
    expect(items.find((i: any) => i.Put?.Item.sk === 'MandateStatus')).toBeUndefined();
  });

  it('writes a DepositIntent outbox row when capitalAmount > 0', async () => {
    await onboardingCompleted({ subject: baseSubject } as any, ctx as any);
    const items = (InvestorProfileRepository as any).prototype.transactWrite.mock.calls[0][0].TransactItems;
    const intent = items.find((i: any) => i.Put?.Item.__typename === 'DepositIntent');
    expect(intent).toBeDefined();
    expect(String(intent.Put.Item.sk)).toMatch(/^DepositIntent#/);
    expect(items.some((i: any) => i.Put?.Item.__typename === 'Deposit')).toBe(false);
  });

  it('e2e- tenant defaults mandate level to ADVISORY', async () => {
    await onboardingCompleted({ subject: { ...baseSubject, tenantId: 'e2e-foo' } } as any,
                              { ...ctx, tenantId: 'e2e-foo' } as any);
    const items = (InvestorProfileRepository as any).prototype.transactWrite.mock.calls[0][0].TransactItems;
    const mandate = items.find((i: any) => i.Put?.Item.sk === 'Mandate').Put.Item;
    expect(mandate.level).toBe('ADVISORY');
  });
});
