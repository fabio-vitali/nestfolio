import { MandateValidator } from '../../src/rules/mandate-validator';
import type { ComplianceInput, MandateSnapshot } from '../../src/rules/rule-engine';

const BASE_MANDATE: MandateSnapshot = {
  level: 'DISCRETIONARY',
  status: 'ACTIVE',
  operatingMode: 'BALANCED',
  effectiveDate: '2024-01-01T00:00:00.000Z',
};

function buildInput(mandateOverrides: Partial<MandateSnapshot> = {}): ComplianceInput {
  return {
    decisionPacketId: 'dp-1',
    tenantId: 't-1',
    userId: 'u-1',
    mandate: { ...BASE_MANDATE, ...mandateOverrides },
    proposedTrades: [],
    portfolioValueCents: 100_000_00,
    riskCategory: 'MODERATE',
    isInitialBuild: false,
    currentPositions: [],
  };
}

describe('MandateValidator', () => {
  const validator = new MandateValidator();

  it('should pass when mandate is active and effective', () => {
    const result = validator.validate(buildInput());

    expect(result.passed).toBe(true);
    expect(result.name).toBe('MANDATE_ACTIVE');
    expect(result.details).toContain('active and in effect');
  });

  it('should fail when mandate effective date is in the future', () => {
    const futureDate = new Date(Date.now() + 86400000 * 30).toISOString();
    const result = validator.validate(buildInput({ effectiveDate: futureDate }));

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

    it('should pass (MANDATE_ACTIVE) when status === ACTIVE explicitly', () => {
      const result = validator.validate(buildInput({ status: 'ACTIVE' }));

      expect(result.passed).toBe(true);
      expect(result.name).toBe('MANDATE_ACTIVE');
    });

    it('should fail with name=MANDATE_REVOKED regardless of level when status === REVOKED', () => {
      // Even an ADVISORY mandate with REVOKED status hits the REVOKED gate first.
      const result = validator.validate(
        buildInput({ status: 'REVOKED', level: 'ADVISORY' }),
      );

      expect(result.passed).toBe(false);
      expect(result.name).toBe('MANDATE_REVOKED');
    });
  });

  // ── operatingMode variations ─────────────────────────────────────────
  describe('operatingMode passthrough', () => {
    it.each(['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE'] as const)(
      'should pass for %s mode when mandate is active and effective',
      (operatingMode) => {
        const result = validator.validate(buildInput({ operatingMode }));

        expect(result.passed).toBe(true);
        expect(result.name).toBe('MANDATE_ACTIVE');
      },
    );
  });
});
