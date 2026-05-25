import { SuitabilityChecker } from '../../src/rules/suitability-checker';
import type { ComplianceInput, RiskCategory } from '../../src/rules/rule-engine';

function buildInput(overrides: Partial<ComplianceInput> = {}): ComplianceInput {
  return {
    decisionPacketId: 'dp-1',
    tenantId: 't-1',
    userId: 'u-1',
    mandate: {
      level: 'DISCRETIONARY',
      status: 'ACTIVE',
      operatingMode: 'BALANCED',
      effectiveDate: '2024-01-01T00:00:00.000Z',
    },
    proposedTrades: [],
    portfolioValueCents: 100_000_00,
    riskCategory: 'MODERATE',
    isInitialBuild: true,
    currentPositions: [],
    ...overrides,
  };
}

describe('SuitabilityChecker', () => {
  const checker = new SuitabilityChecker();

  it('passes when MODERATE + ~55% equity (under 60% cap)', () => {
    const input = buildInput({
      riskCategory: 'MODERATE',
      proposedTrades: [
        { symbol: 'VTI',  assetClass: 'EQUITY', side: 'BUY', quantityOrAmountCents: 14_000, targetWeightPercent: 14, rationale: 'x' },
        { symbol: 'IXUS', assetClass: 'EQUITY', side: 'BUY', quantityOrAmountCents: 14_000, targetWeightPercent: 14, rationale: 'x' },
        { symbol: 'QQQ',  assetClass: 'EQUITY', side: 'BUY', quantityOrAmountCents: 14_000, targetWeightPercent: 14, rationale: 'x' },
        { symbol: 'VWO',  assetClass: 'EQUITY', side: 'BUY', quantityOrAmountCents: 13_000, targetWeightPercent: 13, rationale: 'x' },
        { symbol: 'BND',  assetClass: 'FIXED_INCOME', side: 'BUY', quantityOrAmountCents: 27_000, targetWeightPercent: 27, rationale: 'x' },
        { symbol: 'SHY',  assetClass: 'FIXED_INCOME', side: 'BUY', quantityOrAmountCents: 18_000, targetWeightPercent: 18, rationale: 'x' },
      ],
    });
    const result = checker.check(input);
    expect(result.passed).toBe(true);
  });

  it('blocks when MODERATE + 65% equity (over 60% cap)', () => {
    const input = buildInput({
      riskCategory: 'MODERATE',
      proposedTrades: [
        { symbol: 'VTI', assetClass: 'EQUITY', side: 'BUY', quantityOrAmountCents: 65_000, targetWeightPercent: 65, rationale: 'x' },
      ],
    });
    const result = checker.check(input);
    expect(result.passed).toBe(false);
    expect(result.details).toMatch(/60%/);
    expect(result.details).toMatch(/MODERATE/);
  });

  it('blocks when CONSERVATIVE + 35% equity (over 30% cap)', () => {
    const input = buildInput({
      riskCategory: 'CONSERVATIVE',
      proposedTrades: [
        { symbol: 'VTI', assetClass: 'EQUITY', side: 'BUY', quantityOrAmountCents: 35_000, targetWeightPercent: 35, rationale: 'x' },
      ],
    });
    const result = checker.check(input);
    expect(result.passed).toBe(false);
    expect(result.details).toMatch(/30%/);
  });

  it('blocks when AGGRESSIVE + 95% equity (over 90% cap)', () => {
    const input = buildInput({
      riskCategory: 'AGGRESSIVE',
      proposedTrades: [
        { symbol: 'VTI', assetClass: 'EQUITY', side: 'BUY', quantityOrAmountCents: 95_000, targetWeightPercent: 95, rationale: 'x' },
      ],
    });
    const result = checker.check(input);
    expect(result.passed).toBe(false);
    expect(result.details).toMatch(/90%/);
  });

  it('respects current positions when computing resulting equity', () => {
    const input = buildInput({
      riskCategory: 'MODERATE',
      currentPositions: [{ ticker: 'AAPL', weight: 40 }],
      proposedTrades: [
        { symbol: 'GOOG', assetClass: 'EQUITY', side: 'BUY', quantityOrAmountCents: 25_000, targetWeightPercent: 25, rationale: 'x' },
      ],
    });
    const result = checker.check(input);
    // 40 + 25 = 65 > 60 cap → blocks
    expect(result.passed).toBe(false);
  });

  it('SELL trades subtract from equity', () => {
    const input = buildInput({
      riskCategory: 'MODERATE',
      currentPositions: [{ ticker: 'AAPL', weight: 70 }],
      proposedTrades: [
        { symbol: 'AAPL', assetClass: 'EQUITY', side: 'SELL', quantityOrAmountCents: 20_000, targetWeightPercent: 20, rationale: 'x' },
      ],
    });
    const result = checker.check(input);
    // 70 - 20 = 50 ≤ 60 → passes
    expect(result.passed).toBe(true);
  });

  it('defaults to 60% cap for unrecognized riskCategory at runtime (defensive)', () => {
    const input = buildInput({
      riskCategory: 'GARBAGE' as RiskCategory,
      proposedTrades: [
        { symbol: 'VTI', assetClass: 'EQUITY', side: 'BUY', quantityOrAmountCents: 55_000, targetWeightPercent: 55, rationale: 'x' },
      ],
    });
    const result = checker.check(input);
    expect(result.passed).toBe(true); // 55 ≤ 60 default
  });
});
