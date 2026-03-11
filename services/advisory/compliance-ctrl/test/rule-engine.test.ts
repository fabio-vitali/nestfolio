import { RuleEngine, type ComplianceInput } from '../src/rules/rule-engine';
import { MandateValidator } from '../src/rules/mandate-validator';
import { GuardrailEvaluator } from '../src/rules/guardrail-evaluator';
import { SuitabilityChecker } from '../src/rules/suitability-checker';
import { AuthorityResolver } from '../src/rules/authority-resolver';

function buildInput(overrides: Partial<ComplianceInput> = {}): ComplianceInput {
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
    },
    proposedTrades: [
      {
        symbol: 'AAPL',
        assetClass: 'EQUITY',
        side: 'BUY',
        quantityOrAmountCents: 2_000_00,
        targetWeightPercent: 2,
        rationale: 'Good value',
      },
    ],
    portfolioValue: 100_000_00,
    riskScore: 7,
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

  it('should BLOCK when mandate is revoked', () => {
    const input = buildInput({
      mandate: {
        mandateId: 'm-1',
        level: 'DISCRETIONARY',
        monthlyTurnoverCapPercent: 10,
        maxSingleTradePercent: 5,
        effectiveDate: '2024-01-01T00:00:00.000Z',
        revokedAt: '2025-06-01T00:00:00.000Z',
      },
    });

    const output = engine.evaluate(input);

    expect(output.result).toBe('BLOCKED');
    expect(output.violations.some((v) => v.rule === 'MANDATE_SCOPE')).toBe(true);
  });

  it('should BLOCK when guardrail is violated', () => {
    const input = buildInput({
      proposedTrades: [
        {
          symbol: 'TSLA',
          assetClass: 'EQUITY',
          side: 'BUY',
          quantityOrAmountCents: 10_000_00, // 10% > 5% max single trade
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
      riskScore: 2, // max 20% equity
      currentPositions: [{ ticker: 'AAPL', weight: 18 }],
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

    // 18% + 5% = 23% > 20% max for risk score 2
    expect(output.result).toBe('BLOCKED');
    expect(output.violations.some((v) => v.rule === 'SUITABILITY')).toBe(true);
  });

  it('should APPROVE with L2 for ADVISORY mandate even when all rules pass', () => {
    const input = buildInput({
      mandate: {
        mandateId: 'm-1',
        level: 'ADVISORY',
        monthlyTurnoverCapPercent: 10,
        maxSingleTradePercent: 5,
        effectiveDate: '2024-01-01T00:00:00.000Z',
        revokedAt: null,
      },
    });

    const output = engine.evaluate(input);

    expect(output.result).toBe('APPROVED');
    expect(output.authorityLevel).toBe('L2');
  });

  it('should collect all violations when multiple rules fail', () => {
    const input = buildInput({
      mandate: {
        mandateId: 'm-1',
        level: 'DISCRETIONARY',
        monthlyTurnoverCapPercent: 10,
        maxSingleTradePercent: 5,
        effectiveDate: '2024-01-01T00:00:00.000Z',
        revokedAt: '2025-06-01T00:00:00.000Z', // revoked
      },
      proposedTrades: [
        {
          symbol: 'TSLA',
          assetClass: 'EQUITY',
          side: 'BUY',
          quantityOrAmountCents: 10_000_00, // exceeds single trade limit
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
