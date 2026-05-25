import { GuardrailEvaluator } from '../../src/rules/guardrail-evaluator';
import type { ComplianceInput, MandateSnapshot } from '../../src/rules/rule-engine';

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
    portfolioValueCents: 100_000_00, // $100,000 in cents
    riskCategory: 'MODERATE',
    isInitialBuild: false, // default: steady-state behaviour for existing tests
    currentPositions: [],
    ...overrides,
  };
}

const CONSERVATIVE_MANDATE: MandateSnapshot = {
  level: 'DISCRETIONARY',
  status: 'ACTIVE',
  operatingMode: 'CONSERVATIVE',
  effectiveDate: '2024-01-01T00:00:00.000Z',
};

const BALANCED_MANDATE: MandateSnapshot = {
  level: 'DISCRETIONARY',
  status: 'ACTIVE',
  operatingMode: 'BALANCED',
  effectiveDate: '2024-01-01T00:00:00.000Z',
};

const AGGRESSIVE_MANDATE: MandateSnapshot = {
  level: 'DISCRETIONARY',
  status: 'ACTIVE',
  operatingMode: 'AGGRESSIVE',
  effectiveDate: '2024-01-01T00:00:00.000Z',
};

describe('GuardrailEvaluator', () => {
  const evaluator = new GuardrailEvaluator();

  it('should pass when all trades are within limits (BALANCED)', () => {
    // BALANCED: maxSingleTrade=10%, monthlyTurnover=25%, singleEtfConcentration=30%
    const input = buildInput({
      mandate: BALANCED_MANDATE,
      proposedTrades: [
        {
          symbol: 'AAPL',
          assetClass: 'EQUITY',
          side: 'BUY',
          quantityOrAmountCents: 3_000_00, // 3% of portfolio, under 10% limit
          targetWeightPercent: 3,
          rationale: 'Good value',
        },
      ],
      currentPositions: [{ ticker: 'AAPL', weight: 5 }],
    });

    const results = evaluator.evaluate(input);

    expect(results.every((r) => r.passed)).toBe(true);
  });

  it('should fail when single trade exceeds CONSERVATIVE max single trade percent (5%)', () => {
    // CONSERVATIVE: maxSingleTrade=5%; 10% trade should BLOCK
    const input = buildInput({
      mandate: CONSERVATIVE_MANDATE,
      proposedTrades: [
        {
          symbol: 'TSLA',
          assetClass: 'EQUITY',
          side: 'BUY',
          quantityOrAmountCents: 10_000_00, // 10% of portfolio, limit is 5%
          targetWeightPercent: 10,
          rationale: 'Overweight',
        },
      ],
    });

    const results = evaluator.evaluate(input);
    const tradeCheck = results.find((r) => r.name === 'MAX_SINGLE_TRADE');

    expect(tradeCheck?.passed).toBe(false);
    expect(tradeCheck?.details).toContain('exceeds max single trade limit');
  });

  it('should pass the same 10% trade for AGGRESSIVE mandate (20% limit)', () => {
    // AGGRESSIVE: maxSingleTrade=20%; 10% trade should PASS
    const input = buildInput({
      mandate: AGGRESSIVE_MANDATE,
      proposedTrades: [
        {
          symbol: 'TSLA',
          assetClass: 'EQUITY',
          side: 'BUY',
          quantityOrAmountCents: 10_000_00, // 10% of portfolio, under 20% limit
          targetWeightPercent: 10,
          rationale: 'Growth play',
        },
      ],
    });

    const results = evaluator.evaluate(input);
    const tradeCheck = results.find((r) => r.name === 'MAX_SINGLE_TRADE');

    expect(tradeCheck?.passed).toBe(true);
  });

  it('should fail when concentration limit is exceeded (CONSERVATIVE: 20% limit)', () => {
    // CONSERVATIVE: singleEtfConcentration=20%; 10% current + 15% trade = 25% > 20% → BLOCK
    const input = buildInput({
      mandate: CONSERVATIVE_MANDATE,
      proposedTrades: [
        {
          symbol: 'AAPL',
          assetClass: 'EQUITY',
          side: 'BUY',
          quantityOrAmountCents: 3_000_00,
          targetWeightPercent: 15,
          rationale: 'Add more',
        },
      ],
      currentPositions: [{ ticker: 'AAPL', weight: 10 }],
    });

    const results = evaluator.evaluate(input);
    const concentrationCheck = results.find(
      (r) => r.name === 'CONCENTRATION_LIMIT',
    );

    // 10% + 15% = 25% > 20% singleEtfConcentrationPercent (CONSERVATIVE)
    expect(concentrationCheck?.passed).toBe(false);
    expect(concentrationCheck?.details).toContain('exceeding concentration limit');
  });

  it('should fail when turnover cap is exceeded (CONSERVATIVE: 10% cap)', () => {
    // CONSERVATIVE: monthlyTurnover=10%; 3 trades × 4% = 12% > 10% → BLOCK
    const input = buildInput({
      mandate: CONSERVATIVE_MANDATE,
      proposedTrades: [
        {
          symbol: 'AAPL',
          assetClass: 'EQUITY',
          side: 'BUY',
          quantityOrAmountCents: 4_000_00,
          targetWeightPercent: 4,
          rationale: 'Buy',
        },
        {
          symbol: 'GOOG',
          assetClass: 'EQUITY',
          side: 'SELL',
          quantityOrAmountCents: 4_000_00,
          targetWeightPercent: 4,
          rationale: 'Sell',
        },
        {
          symbol: 'MSFT',
          assetClass: 'EQUITY',
          side: 'BUY',
          quantityOrAmountCents: 4_000_00,
          targetWeightPercent: 4,
          rationale: 'Buy',
        },
      ],
    });

    const results = evaluator.evaluate(input);
    const turnoverCheck = results.find((r) => r.name === 'TURNOVER_CAP');

    // Total turnover: 12% > 10% cap (CONSERVATIVE)
    expect(turnoverCheck?.passed).toBe(false);
    expect(turnoverCheck?.details).toContain('exceeds monthly cap');
  });

  it('should pass concentration when selling reduces position (CONSERVATIVE: 20% limit)', () => {
    // CONSERVATIVE: singleEtfConcentration=20%; 24% - 5% = 19% < 20% → PASS
    const input = buildInput({
      mandate: CONSERVATIVE_MANDATE,
      proposedTrades: [
        {
          symbol: 'AAPL',
          assetClass: 'EQUITY',
          side: 'SELL',
          quantityOrAmountCents: 2_000_00,
          targetWeightPercent: 5,
          rationale: 'Reduce',
        },
      ],
      currentPositions: [{ ticker: 'AAPL', weight: 24 }],
    });

    const results = evaluator.evaluate(input);
    const concentrationCheck = results.find(
      (r) => r.name === 'CONCENTRATION_LIMIT',
    );

    // 24% - 5% = 19%, within 20% CONSERVATIVE limit
    expect(concentrationCheck?.passed).toBe(true);
  });

  describe('isInitialBuild — initial portfolio construction skip', () => {
    it('isInitialBuild=true → MAX_SINGLE_TRADE passes with "skipped" details (BND@27 that would otherwise fail)', () => {
      const input = buildInput({
        isInitialBuild: true,
        portfolioValueCents: 100_000, // $1000
        proposedTrades: [
          { symbol: 'BND', assetClass: 'FIXED_INCOME', side: 'BUY', quantityOrAmountCents: 27_000, targetWeightPercent: 27, rationale: 'x' },
        ],
      });
      const results = evaluator.evaluate(input);
      const single = results.find((r) => r.name === 'MAX_SINGLE_TRADE')!;
      expect(single.passed).toBe(true);
      expect(single.details).toMatch(/[Ss]kipped/);
      expect(single.details).toMatch(/initial portfolio construction/i);
    });

    it('isInitialBuild=true → TURNOVER_CAP passes with "skipped" details', () => {
      const input = buildInput({
        isInitialBuild: true,
        portfolioValueCents: 100_000,
        proposedTrades: [
          { symbol: 'VTI',  assetClass: 'EQUITY', side: 'BUY', quantityOrAmountCents: 14_000, targetWeightPercent: 14, rationale: 'x' },
          { symbol: 'IXUS', assetClass: 'EQUITY', side: 'BUY', quantityOrAmountCents: 14_000, targetWeightPercent: 14, rationale: 'x' },
          { symbol: 'QQQ',  assetClass: 'EQUITY', side: 'BUY', quantityOrAmountCents: 14_000, targetWeightPercent: 14, rationale: 'x' },
          { symbol: 'VWO',  assetClass: 'EQUITY', side: 'BUY', quantityOrAmountCents: 13_000, targetWeightPercent: 13, rationale: 'x' },
          { symbol: 'BND',  assetClass: 'FIXED_INCOME', side: 'BUY', quantityOrAmountCents: 27_000, targetWeightPercent: 27, rationale: 'x' },
          { symbol: 'SHY',  assetClass: 'FIXED_INCOME', side: 'BUY', quantityOrAmountCents: 18_000, targetWeightPercent: 18, rationale: 'x' },
        ],
      });
      const results = evaluator.evaluate(input);
      const turnover = results.find((r) => r.name === 'TURNOVER_CAP')!;
      expect(turnover.passed).toBe(true);
      expect(turnover.details).toMatch(/[Ss]kipped/);
    });

    it('isInitialBuild=true → CONCENTRATION_LIMIT still runs and still blocks on >30% in a single allocation', () => {
      const input = buildInput({
        isInitialBuild: true,
        portfolioValueCents: 100_000,
        proposedTrades: [
          // Single 35% allocation exceeds BALANCED concentration cap of 30%
          { symbol: 'AAPL', assetClass: 'EQUITY', side: 'BUY', quantityOrAmountCents: 35_000, targetWeightPercent: 35, rationale: 'x' },
        ],
      });
      const results = evaluator.evaluate(input);
      const conc = results.find((r) => r.name === 'CONCENTRATION_LIMIT')!;
      expect(conc.passed).toBe(false);
      expect(conc.details).toMatch(/35/);
    });

    it('isInitialBuild=false → MAX_SINGLE_TRADE fires normally on real over-cap trade in canonical cents (units regression)', () => {
      // Real-cents regression: a 25% trade against a $1000 portfolio = 25_000 cents.
      // BALANCED maxSingleTradePercent=10 → maxAmountCents = 100_000 * 10 / 100 = 10_000.
      // 25_000 > 10_000 → fires.
      const input = buildInput({
        isInitialBuild: false,
        portfolioValueCents: 100_000,
        proposedTrades: [
          { symbol: 'VTI', assetClass: 'EQUITY', side: 'BUY', quantityOrAmountCents: 25_000, targetWeightPercent: 25, rationale: 'x' },
        ],
      });
      const results = evaluator.evaluate(input);
      const single = results.find((r) => r.name === 'MAX_SINGLE_TRADE')!;
      expect(single.passed).toBe(false);
      expect(single.details).toMatch(/25\.0%/); // reported percent matches canonical units (not 2500.0%)
      expect(single.details).toMatch(/10%/);
    });
  });
});
