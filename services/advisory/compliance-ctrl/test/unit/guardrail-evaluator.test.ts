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
    portfolioValue: 100_000_00, // $100,000 in cents
    riskScore: 5,
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
});
