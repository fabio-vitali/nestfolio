import { GuardrailEvaluator } from '../../src/rules/guardrail-evaluator';
import type { ComplianceInput } from '../../src/rules/rule-engine';

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
      equityRiskBandPercent: 6,
      driftTriggerPercent: 4,
      singleEtfConcentrationPercent: 30,
      drawdownCircuitBreakerPercent: 12,
      effectiveDate: '2024-01-01T00:00:00.000Z',
      revokedAt: null,
    },
    proposedTrades: [],
    portfolioValue: 100_000_00, // $100,000 in cents
    riskScore: 5,
    currentPositions: [],
    ...overrides,
  };
}

describe('GuardrailEvaluator', () => {
  const evaluator = new GuardrailEvaluator();

  it('should pass when all trades are within limits', () => {
    const input = buildInput({
      proposedTrades: [
        {
          symbol: 'AAPL',
          assetClass: 'EQUITY',
          side: 'BUY',
          quantityOrAmountCents: 3_000_00, // 3% of portfolio
          targetWeightPercent: 3,
          rationale: 'Good value',
        },
      ],
      currentPositions: [{ ticker: 'AAPL', weight: 5 }],
    });

    const results = evaluator.evaluate(input);

    expect(results.every((r) => r.passed)).toBe(true);
  });

  it('should fail when single trade exceeds max single trade percent', () => {
    const input = buildInput({
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

  it('should fail when concentration limit is exceeded', () => {
    const input = buildInput({
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
      currentPositions: [{ ticker: 'AAPL', weight: 20 }],
    });

    const results = evaluator.evaluate(input);
    const concentrationCheck = results.find(
      (r) => r.name === 'CONCENTRATION_LIMIT',
    );

    // 20% + 15% = 35% > 30% singleEtfConcentrationPercent
    expect(concentrationCheck?.passed).toBe(false);
    expect(concentrationCheck?.details).toContain('exceeding concentration limit');
  });

  it('should fail when turnover cap is exceeded', () => {
    const input = buildInput({
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

    // Total turnover: 12% > 10% cap
    expect(turnoverCheck?.passed).toBe(false);
    expect(turnoverCheck?.details).toContain('exceeds monthly cap');
  });

  it('should pass concentration when selling reduces position', () => {
    const input = buildInput({
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

    // 24% - 5% = 19%, within 30% limit
    expect(concentrationCheck?.passed).toBe(true);
  });
});
