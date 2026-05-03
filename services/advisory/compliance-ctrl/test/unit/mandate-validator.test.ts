import { MandateValidator } from '../../src/rules/mandate-validator';
import type { ComplianceInput } from '../../src/rules/rule-engine';

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
      equityRiskBandPercent: 6,
      driftTriggerPercent: 4,
      singleEtfConcentrationPercent: 30,
      drawdownCircuitBreakerPercent: 12,
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

  // ── MANDATE_REVOKED status gate (set by MANDATE_REVOKED projection) ───
  describe('MANDATE_REVOKED status gate', () => {
    it('should fail with name=MANDATE_REVOKED when mandate.status === REVOKED', () => {
      const result = validator.validate(buildInput({ status: 'REVOKED' }));

      expect(result.passed).toBe(false);
      expect(result.name).toBe('MANDATE_REVOKED');
      expect(result.details).toContain('revoked');
    });

    it('should pass (MANDATE_ACTIVE) when status is undefined and mandate is otherwise active (legacy snapshots default to allowed)', () => {
      const result = validator.validate(buildInput({ status: undefined }));

      expect(result.passed).toBe(true);
      expect(result.name).toBe('MANDATE_ACTIVE');
    });

    it('should pass (MANDATE_ACTIVE) when status === ACTIVE explicitly', () => {
      const result = validator.validate(buildInput({ status: 'ACTIVE' }));

      expect(result.passed).toBe(true);
      expect(result.name).toBe('MANDATE_ACTIVE');
    });

    it('REVOKED status takes precedence over revokedAt timestamp check', () => {
      // Even with revokedAt set, status=REVOKED short-circuits with the
      // dedicated MANDATE_REVOKED name (single source of truth).
      const result = validator.validate(
        buildInput({
          status: 'REVOKED',
          revokedAt: '2025-01-15T00:00:00.000Z',
        }),
      );

      expect(result.passed).toBe(false);
      expect(result.name).toBe('MANDATE_REVOKED');
    });
  });
});
