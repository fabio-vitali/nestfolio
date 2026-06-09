import {
  DepositInitiatedSchema,
  WithdrawalInitiatedSchema,
  MandateSchema,
  ExecutionModeChangedSchema,
} from '../../../src/domain/contracts';

describe('investor-adpt cross-domain contracts', () => {
  it('DepositInitiatedSchema parses (regression)', () => {
    expect(DepositInitiatedSchema.parse({
      depositId: 'd1', amountCents: 1000, currency: 'USD', timestamp: '2026-06-09T00:00:00.000Z',
    }).depositId).toBe('d1');
  });

  it('WithdrawalInitiatedSchema parses (regression)', () => {
    expect(WithdrawalInitiatedSchema.parse({
      withdrawalId: 'w1', amountCents: 1000, currency: 'USD', timestamp: '2026-06-09T00:00:00.000Z',
    }).withdrawalId).toBe('w1');
  });

  it('MandateSchema parses a representative Mandate subject (dry — identity stripped)', () => {
    const subject = {
      tenantId: 't', userId: 'u', region: 'us-east-1',
      mandateId: 'm1', level: 'ADVISORY', status: 'ACTIVE',
      operatingMode: 'BALANCED', effectiveDate: '2026-06-09T00:00:00.000Z',
      revokedAt: null, __version: 1,
    };
    const parsed = MandateSchema.parse(subject);
    expect('tenantId' in parsed).toBe(false);
    expect(parsed.mandateId).toBe('m1');
    expect(parsed.operatingMode).toBe('BALANCED');
  });

  it('MandateSchema rejects an invalid level', () => {
    expect(() => MandateSchema.parse({
      mandateId: 'm1', level: 'BOGUS', status: 'ACTIVE',
      operatingMode: 'BALANCED', effectiveDate: '2026-06-09T00:00:00.000Z',
    })).toThrow();
  });

  it('ExecutionModeChangedSchema parses a representative change subject', () => {
    const subject = {
      changeId: 't#u#2026', fromMode: 'simulation', toMode: 'live',
      changedAt: '2026-06-09T00:00:00.000Z',
    };
    expect(ExecutionModeChangedSchema.parse(subject)).toEqual(subject);
  });

  it('ExecutionModeChangedSchema rejects an invalid mode', () => {
    expect(() => ExecutionModeChangedSchema.parse({
      changeId: 'x', fromMode: 'simulation', toMode: 'paper', changedAt: '2026-06-09T00:00:00.000Z',
    })).toThrow();
  });
});
