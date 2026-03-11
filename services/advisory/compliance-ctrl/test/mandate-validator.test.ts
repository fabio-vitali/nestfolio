import { MandateValidator } from '../src/rules/mandate-validator';
import type { ComplianceInput } from '../src/rules/rule-engine';

function buildInput(overrides: Partial<ComplianceInput['mandate']> = {}): ComplianceInput {
  return {
    decisionPacketId: 'dp-1',
    tenantId: 't-1',
    userId: 'u-1',
    mandate: {
      mandateId: 'm-1',
      level: 'DISCRETIONARY',
      monthlyTurnoverCapPercent: 10,
      maxSingleTradePercent: 5,
      effectiveDate: '2024-01-01T00:00:00.000Z',
      revokedAt: null,
      ...overrides,
    },
    proposedTrades: [],
    portfolioValue: 100_000_00,
    riskScore: 5,
    currentPositions: [],
  };
}

describe('MandateValidator', () => {
  const validator = new MandateValidator();

  it('should pass when mandate is active and effective', () => {
    const result = validator.validate(buildInput());

    expect(result.passed).toBe(true);
    expect(result.name).toBe('MANDATE_ACTIVE');
  });

  it('should fail when mandate is revoked', () => {
    const result = validator.validate(
      buildInput({ revokedAt: '2025-01-15T00:00:00.000Z' }),
    );

    expect(result.passed).toBe(false);
    expect(result.details).toContain('revoked');
  });

  it('should fail when mandate effective date is in the future', () => {
    const futureDate = new Date(Date.now() + 86400000 * 30).toISOString();
    const result = validator.validate(
      buildInput({ effectiveDate: futureDate }),
    );

    expect(result.passed).toBe(false);
    expect(result.details).toContain('not yet effective');
  });
});
