import { onboardingCompleted } from '../../../src/transforms/onboarding-completed';
import { InvestorProfileRepository } from '../../../src/repositories/investor-profile.repository';

jest.mock('../../../src/repositories/investor-profile.repository');

describe('onboardingCompleted transform', () => {
  const baseSubject = {
    email: 'u1@example.com',
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
    expect(profile.mandateLevel).toBe('DISCRETIONARY'); // subject omits mandateLevel → default DISCRETIONARY
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

  it('honors an explicit mandateLevel from the subject (ADVISORY)', async () => {
    await onboardingCompleted({ subject: { ...baseSubject, mandateLevel: 'ADVISORY' } } as any, ctx as any);
    const items = (InvestorProfileRepository as any).prototype.transactWrite.mock.calls[0][0].TransactItems;
    const mandate = items.find((i: any) => i.Put?.Item.sk === 'Mandate').Put.Item;
    const profile = items.find((i: any) => i.Put?.Item.sk === 'InvestorProfile').Put.Item;
    expect(mandate.level).toBe('ADVISORY');
    expect(profile.mandateLevel).toBe('ADVISORY');
  });

  it('explicit subject mandateLevel overrides any tenant prefix (e2e- tenant, DISCRETIONARY)', async () => {
    // Proves the old tenantId.startsWith('e2e-') → ADVISORY test-ism is gone: the
    // subject value wins regardless of prefix.
    await onboardingCompleted({ subject: { ...baseSubject, mandateLevel: 'DISCRETIONARY' } } as any,
                              { ...ctx, tenantId: 'e2e-foo' } as any);
    const items = (InvestorProfileRepository as any).prototype.transactWrite.mock.calls[0][0].TransactItems;
    const mandate = items.find((i: any) => i.Put?.Item.sk === 'Mandate').Put.Item;
    expect(mandate.level).toBe('DISCRETIONARY');
  });

  it('defaults mandate level to DISCRETIONARY when the subject omits it — independent of tenant prefix', async () => {
    // No more prefix-sniffing: an e2e- tenant with no explicit mandateLevel defaults to
    // DISCRETIONARY exactly like a production tenant (the prod default).
    await onboardingCompleted({ subject: baseSubject } as any,
                              { ...ctx, tenantId: 'e2e-foo' } as any);
    const items = (InvestorProfileRepository as any).prototype.transactWrite.mock.calls[0][0].TransactItems;
    const mandate = items.find((i: any) => i.Put?.Item.sk === 'Mandate').Put.Item;
    expect(mandate.level).toBe('DISCRETIONARY');
  });

  it('stamps __version: 1 on the seeded Mandate row (WS-B carriage)', async () => {
    await onboardingCompleted({ subject: baseSubject } as any, ctx as any);
    const items = (InvestorProfileRepository as any).prototype.transactWrite.mock.calls[0][0].TransactItems;
    const mandate = items.find((i: any) => i.Put?.Item.sk === 'Mandate').Put.Item;
    expect(mandate.__version).toBe(1);
  });
});
