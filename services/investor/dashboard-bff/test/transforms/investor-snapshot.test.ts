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

  it('should project goalType and onboardedAt for GOAL_SET', () => {
    expect(investorSnapshot(makeUow('GOAL_SET', { objective: 'income' }) as any)).toEqual(
      project('InvestorSnapshot', {
        tenantId: 't1',
        goalType: 'income',
        onboardedAt: '2026-01-01T00:00:00.000Z',
      }, { pk: 'T#t1', sk: 'InvestorSnapshot' }),
    );
  });

  it('should project goalType only for GOAL_UPDATED (no onboardedAt)', () => {
    expect(investorSnapshot(makeUow('GOAL_UPDATED', { objective: 'growth' }) as any)).toEqual(
      project('InvestorSnapshot', {
        tenantId: 't1',
        goalType: 'growth',
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

  it('should project operatingMode for OPERATING_MODE_SELECTED', () => {
    expect(investorSnapshot(makeUow('OPERATING_MODE_SELECTED', { mode: 'AUTO' }) as any)).toEqual(
      project('InvestorSnapshot', {
        tenantId: 't1',
        operatingMode: 'AUTO',
      }, { pk: 'T#t1', sk: 'InvestorSnapshot' }),
    );
  });

  it('should project operatingMode for OPERATING_MODE_CHANGED', () => {
    expect(investorSnapshot(makeUow('OPERATING_MODE_CHANGED', { mode: 'MANUAL' }) as any)).toEqual(
      project('InvestorSnapshot', {
        tenantId: 't1',
        operatingMode: 'MANUAL',
      }, { pk: 'T#t1', sk: 'InvestorSnapshot' }),
    );
  });
});
