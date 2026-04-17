import { SuitabilityChecker } from '../../src/rules/suitability-checker';
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
    portfolioValue: 100_000_00,
    riskScore: 5,
    currentPositions: [],
    ...overrides,
  };
}

describe('SuitabilityChecker', () => {
  const checker = new SuitabilityChecker();

  it('should pass when equity exposure is within risk score limits', () => {
    const input = buildInput({
      riskScore: 7, // max 70% equity
      currentPositions: [{ ticker: 'AAPL', weight: 30 }],
      proposedTrades: [
        {
          symbol: 'GOOG',
          assetClass: 'EQUITY',
          side: 'BUY',
          quantityOrAmountCents: 10_000_00,
          targetWeightPercent: 10,
          rationale: 'Diversify',
        },
      ],
    });

    const result = checker.check(input);

    // Current: 30%, adding 10% equity = 40%, max 70%
    expect(result.passed).toBe(true);
  });

  it('should fail when equity exposure exceeds risk score limits', () => {
    const input = buildInput({
      riskScore: 3, // max 30% equity
      currentPositions: [{ ticker: 'AAPL', weight: 25 }],
      proposedTrades: [
        {
          symbol: 'GOOG',
          assetClass: 'EQUITY',
          side: 'BUY',
          quantityOrAmountCents: 10_000_00,
          targetWeightPercent: 10,
          rationale: 'Buy more equity',
        },
      ],
    });

    const result = checker.check(input);

    // Current: 25%, adding 10% = 35%, max 30%
    expect(result.passed).toBe(false);
    expect(result.details).toContain('exceeds max');
  });

  it('should pass when selling equity reduces exposure within limits', () => {
    const input = buildInput({
      riskScore: 3, // max 30%
      currentPositions: [
        { ticker: 'AAPL', weight: 20 },
        { ticker: 'GOOG', weight: 15 },
      ],
      proposedTrades: [
        {
          symbol: 'GOOG',
          assetClass: 'EQUITY',
          side: 'SELL',
          quantityOrAmountCents: 5_000_00,
          targetWeightPercent: 10,
          rationale: 'Reduce exposure',
        },
      ],
    });

    const result = checker.check(input);

    // Current: 35%, selling 10% equity = 25%, max 30%
    expect(result.passed).toBe(true);
  });

  it('should ignore non-equity asset classes in suitability check', () => {
    const input = buildInput({
      riskScore: 2, // max 20% equity
      currentPositions: [{ ticker: 'SPY', weight: 15 }],
      proposedTrades: [
        {
          symbol: 'AGG',
          assetClass: 'FIXED_INCOME',
          side: 'BUY',
          quantityOrAmountCents: 20_000_00,
          targetWeightPercent: 20,
          rationale: 'Buy bonds',
        },
      ],
    });

    const result = checker.check(input);

    // Only 15% equity (bonds not counted), max 20%
    expect(result.passed).toBe(true);
  });
});
