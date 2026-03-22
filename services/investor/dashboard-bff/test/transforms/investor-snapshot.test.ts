import { project } from '@nestfolio/event-processor';
import { investorSnapshot } from '../../src/transforms/investor-snapshot';

describe('investorSnapshot transform', () => {
  const makeUow = (eventType: string, subject: Record<string, unknown> = {}) => ({
    event: {
      id: 'e1',
      type: eventType,
      timestamp: '2026-01-01T00:00:00.000Z',
      subject,
      context: { tenantId: 't1' },
    },
    payload: {},
    record: {},
  });

  it('should project full snapshot for ONBOARDING_COMPLETED', () => {
    expect(investorSnapshot(makeUow('ONBOARDING_COMPLETED', {
      operatingMode: 'AUTO', riskScore: 7, goalId: 'growth',
    }) as any)).toEqual(
      project('InvestorSnapshot', {
        tenantId: 't1',
        operatingMode: 'AUTO',
        riskLevel: '7',
        goalType: 'growth',
        onboardedAt: '2026-01-01T00:00:00.000Z',
      }, { pk: 'T#t1', sk: 'InvestorSnapshot' }),
    );
  });

  it('should project goalType for GOAL_SET', () => {
    expect(investorSnapshot(makeUow('GOAL_SET', { objective: 'income' }) as any)).toEqual(
      project('InvestorSnapshot', {
        tenantId: 't1',
        goalType: 'income',
      }, { pk: 'T#t1', sk: 'InvestorSnapshot' }),
    );
  });

  it('should project riskLevel for RISK_PROFILE_SET', () => {
    expect(investorSnapshot(makeUow('RISK_PROFILE_SET', { score: 5 }) as any)).toEqual(
      project('InvestorSnapshot', {
        tenantId: 't1',
        riskLevel: '5',
      }, { pk: 'T#t1', sk: 'InvestorSnapshot' }),
    );
  });
});
