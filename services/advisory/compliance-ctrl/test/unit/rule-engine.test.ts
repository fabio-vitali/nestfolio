import { RuleEngine, type ComplianceInput, type MandateSnapshot } from '../../src/rules/rule-engine';
import { MandateValidator } from '../../src/rules/mandate-validator';
import { GuardrailEvaluator } from '../../src/rules/guardrail-evaluator';
import { SuitabilityChecker } from '../../src/rules/suitability-checker';
import { AuthorityResolver } from '../../src/rules/authority-resolver';

const BALANCED_MANDATE: MandateSnapshot = {
  level: 'DISCRETIONARY',
  status: 'ACTIVE',
  operatingMode: 'BALANCED',
  effectiveDate: '2024-01-01T00:00:00.000Z',
};

function buildInput(overrides: Partial<ComplianceInput> = {}): ComplianceInput {
  return {
    decisionPacketId: 'dp-1',
    tenantId: 't-1',
    userId: 'u-1',
    mandate: { ...BALANCED_MANDATE },
    proposedTrades: [
      {
        symbol: 'AAPL',
        assetClass: 'EQUITY',
        side: 'BUY',
        quantityOrAmountCents: 2_000_00, // 2% — well within BALANCED limits
        targetWeightPercent: 2,
        rationale: 'Good value',
      },
    ],
    portfolioValueCents: 100_000_00,
    riskCategory: 'AGGRESSIVE', // old riskScore=7 → closest category is AGGRESSIVE (cap 90%)
    isInitialBuild: false,
    currentPositions: [{ ticker: 'MSFT', weight: 10 }],
    ...overrides,
  };
}

describe('RuleEngine', () => {
  const engine = new RuleEngine(
    new MandateValidator(),
    new GuardrailEvaluator(),
    new SuitabilityChecker(),
    new AuthorityResolver(),
  );

  it('should APPROVE with L1 when all rules pass for DISCRETIONARY mandate', () => {
    const output = engine.evaluate(buildInput());

    expect(output.result).toBe('APPROVED');
    expect(output.authorityLevel).toBe('L1');
    expect(output.violations).toHaveLength(0);
    expect(output.checks.length).toBeGreaterThan(0);
    expect(output.checks.every((c) => c.passed)).toBe(true);
  });

  it('should BLOCK when mandate status is REVOKED', () => {
    const input = buildInput({
      mandate: { ...BALANCED_MANDATE, status: 'REVOKED' },
    });

    const output = engine.evaluate(input);

    expect(output.result).toBe('BLOCKED');
    expect(output.violations.some((v) => v.rule === 'MANDATE_SCOPE')).toBe(true);
  });

  it('should BLOCK when guardrail is violated (CONSERVATIVE mode — max single trade 5%)', () => {
    // CONSERVATIVE: maxSingleTradePercent=5; 10% trade exceeds it.
    const input = buildInput({
      mandate: { ...BALANCED_MANDATE, operatingMode: 'CONSERVATIVE' },
      proposedTrades: [
        {
          symbol: 'TSLA',
          assetClass: 'EQUITY',
          side: 'BUY',
          quantityOrAmountCents: 10_000_00, // 10% > 5% conservative limit
          targetWeightPercent: 10,
          rationale: 'Overweight',
        },
      ],
    });

    const output = engine.evaluate(input);

    expect(output.result).toBe('BLOCKED');
    expect(output.violations.some((v) => v.rule === 'MAX_SINGLE_TRADE')).toBe(true);
  });

  it('should BLOCK when suitability check fails', () => {
    const input = buildInput({
      riskCategory: 'CONSERVATIVE', // old riskScore=2 → CONSERVATIVE (cap 30%)
      currentPositions: [{ ticker: 'AAPL', weight: 28 }],
      proposedTrades: [
        {
          symbol: 'GOOG',
          assetClass: 'EQUITY',
          side: 'BUY',
          quantityOrAmountCents: 4_000_00,
          targetWeightPercent: 5,
          rationale: 'Buy more',
        },
      ],
    });

    const output = engine.evaluate(input);

    // 28% + 5% = 33% > 30% max for CONSERVATIVE risk category
    expect(output.result).toBe('BLOCKED');
    expect(output.violations.some((v) => v.rule === 'SUITABILITY')).toBe(true);
  });

  it('should APPROVE with L2 for ADVISORY mandate even when all rules pass', () => {
    const input = buildInput({
      mandate: { ...BALANCED_MANDATE, level: 'ADVISORY' },
    });

    const output = engine.evaluate(input);

    expect(output.result).toBe('APPROVED');
    expect(output.authorityLevel).toBe('L2');
  });

  // ── MANDATE_REVOKED end-to-end gate ──────────────────────────────────
  describe('MANDATE_REVOKED status gate end-to-end', () => {
    it('should BLOCK with L2 + MANDATE_REVOKED check when mandate.status === REVOKED', () => {
      const input = buildInput({
        mandate: { ...BALANCED_MANDATE, status: 'REVOKED' },
      });

      const output = engine.evaluate(input);

      // Result is BLOCKED because mandate-validator emits a BLOCKING violation.
      expect(output.result).toBe('BLOCKED');

      // Check trace carries the MANDATE_REVOKED name (single source of truth
      // emitted by mandate-validator's status-driven gate).
      const revokedCheck = output.checks.find((c) => c.name === 'MANDATE_REVOKED');
      expect(revokedCheck).toBeDefined();
      expect(revokedCheck!.passed).toBe(false);

      // Rule engine wraps the failed mandate check as a MANDATE_SCOPE violation
      // with BLOCKING severity (existing wiring — same as revokedAt path).
      const mandateViolation = output.violations.find((v) => v.rule === 'MANDATE_SCOPE');
      expect(mandateViolation).toBeDefined();
      expect(mandateViolation!.severity).toBe('BLOCKING');
      expect(mandateViolation!.description).toContain('revoked');

      // Authority resolver forces L2 on REVOKED.
      expect(output.authorityLevel).toBe('L2');
    });

    it('should BLOCK on REVOKED even when all other rules would pass', () => {
      const input = buildInput({
        mandate: { ...BALANCED_MANDATE, status: 'REVOKED' },
      });

      const output = engine.evaluate(input);

      expect(output.result).toBe('BLOCKED');
      expect(output.checks.some((c) => c.name === 'MANDATE_REVOKED' && !c.passed)).toBe(true);
    });
  });

  it('should collect all violations when multiple rules fail', () => {
    // REVOKED mandate + oversized trade (CONSERVATIVE mode)
    const input = buildInput({
      mandate: { ...BALANCED_MANDATE, status: 'REVOKED', operatingMode: 'CONSERVATIVE' },
      proposedTrades: [
        {
          symbol: 'TSLA',
          assetClass: 'EQUITY',
          side: 'BUY',
          quantityOrAmountCents: 10_000_00, // 10% > 5% conservative single-trade limit
          targetWeightPercent: 10,
          rationale: 'Overweight',
        },
      ],
    });

    const output = engine.evaluate(input);

    expect(output.result).toBe('BLOCKED');
    // Should have both mandate and guardrail violations
    expect(output.violations.length).toBeGreaterThanOrEqual(2);
  });
});
