import { project } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';
import { investorSnapshot } from '../../src/transforms/investor-snapshot';

type TestUow = UnitOfWork<BusEvent<Record<string, unknown>>>;

describe('investorSnapshot transform', () => {
  const makeUow = (eventType: string, subject: Record<string, unknown> = {}): TestUow => ({
    event: {
      id: 'e1',
      type: eventType,
      timestamp: '2026-01-01T00:00:00.000Z',
      subject,
      context: { tenantId: 't1' },
    },
    payload: {},
    record: {},
  }) as unknown as TestUow;

  it('should project goalType and onboardedAt for GOAL_CREATED', () => {
    expect(investorSnapshot(makeUow('GOAL_CREATED', { objective: 'income' }))).toEqual(
      project('InvestorSnapshot', {
        tenantId: 't1',
        goalType: 'income',
        onboardedAt: '2026-01-01T00:00:00.000Z',
      }, { pk: 'T#t1', sk: 'InvestorSnapshot' }),
    );
  });

  it('should project goalType only for GOAL_UPDATED (no onboardedAt)', () => {
    expect(investorSnapshot(makeUow('GOAL_UPDATED', { objective: 'growth' }))).toEqual(
      project('InvestorSnapshot', {
        tenantId: 't1',
        goalType: 'growth',
      }, { pk: 'T#t1', sk: 'InvestorSnapshot' }),
    );
  });

  it('should project riskLevel for RISK_PROFILE_CREATED', () => {
    expect(investorSnapshot(makeUow('RISK_PROFILE_CREATED', { score: 5 }))).toEqual(
      project('InvestorSnapshot', {
        tenantId: 't1',
        riskLevel: '5',
      }, { pk: 'T#t1', sk: 'InvestorSnapshot' }),
    );
  });

  it('should project operatingMode for OPERATING_MODE_SELECTED', () => {
    expect(investorSnapshot(makeUow('OPERATING_MODE_SELECTED', { mode: 'AUTO' }))).toEqual(
      project('InvestorSnapshot', {
        tenantId: 't1',
        operatingMode: 'AUTO',
      }, { pk: 'T#t1', sk: 'InvestorSnapshot' }),
    );
  });

  it('should project operatingMode for OPERATING_MODE_CHANGED', () => {
    expect(investorSnapshot(makeUow('OPERATING_MODE_CHANGED', { mode: 'MANUAL' }))).toEqual(
      project('InvestorSnapshot', {
        tenantId: 't1',
        operatingMode: 'MANUAL',
      }, { pk: 'T#t1', sk: 'InvestorSnapshot' }),
    );
  });
});
