import { AuthorityResolver } from '../src/rules/authority-resolver';
import type { ComplianceInput, Violation } from '../src/rules/rule-engine';

/** Balanced-mode defaults */
const BALANCED_MANDATE = {
  mandateId: 'm-1',
  level: 'DISCRETIONARY' as const,
  monthlyTurnoverCapPercent: 25,
  maxSingleTradePercent: 10,
  equityRiskBandPercent: 6,
  driftTriggerPercent: 4,
  singleEtfConcentrationPercent: 30,
  drawdownCircuitBreakerPercent: 12,
  effectiveDate: '2024-01-01T00:00:00.000Z',
  revokedAt: null,
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
        quantityOrAmountCents: 1_000_00,
        targetWeightPercent: 2,
        rationale: 'Small buy',
      },
    ],
    portfolioValue: 100_000_00,
    riskScore: 5,
    currentPositions: [],
    ...overrides,
  };
}

describe('AuthorityResolver', () => {
  const resolver = new AuthorityResolver();

  it('should resolve to L1 for DISCRETIONARY mandate with small trade within thresholds', () => {
    const result = resolver.resolve(buildInput(), []);

    expect(result).toBe('L1');
  });

  it('should resolve to L2 for ADVISORY mandate', () => {
    const input = buildInput({
      mandate: { ...BALANCED_MANDATE, level: 'ADVISORY' },
    });

    const result = resolver.resolve(input, []);

    expect(result).toBe('L2');
  });

  it('should resolve to L2 when there are violations', () => {
    const violations: Violation[] = [
      { rule: 'SOME_RULE', description: 'Some violation', severity: 'WARNING' },
    ];

    const result = resolver.resolve(buildInput(), violations);

    expect(result).toBe('L2');
  });

  it('should resolve to L2 when trade exceeds Balanced maxSingleTradePercent (10%)', () => {
    const input = buildInput({
      proposedTrades: [
        {
          symbol: 'AAPL',
          assetClass: 'EQUITY',
          side: 'BUY',
          quantityOrAmountCents: 11_000_00, // 11% of $100k portfolio > 10% limit
          targetWeightPercent: 11,
          rationale: 'Oversized buy',
        },
      ],
    });

    const result = resolver.resolve(input, []);

    expect(result).toBe('L2');
  });

  it('should resolve to L1 when trade is within Balanced maxSingleTradePercent (10%)', () => {
    const input = buildInput({
      proposedTrades: [
        {
          symbol: 'AAPL',
          assetClass: 'EQUITY',
          side: 'BUY',
          quantityOrAmountCents: 9_000_00, // 9% of $100k portfolio < 10% limit
          targetWeightPercent: 9,
          rationale: 'Within limit',
        },
      ],
    });

    const result = resolver.resolve(input, []);

    expect(result).toBe('L1');
  });

  it('should resolve to L2 when trade exceeds Conservative maxSingleTradePercent (5%)', () => {
    const input = buildInput({
      mandate: {
        ...BALANCED_MANDATE,
        maxSingleTradePercent: 5,
        monthlyTurnoverCapPercent: 15,
      },
      proposedTrades: [
        {
          symbol: 'AAPL',
          assetClass: 'EQUITY',
          side: 'BUY',
          quantityOrAmountCents: 6_000_00, // 6% of $100k portfolio > 5% limit
          targetWeightPercent: 6,
          rationale: 'Conservative-exceeding buy',
        },
      ],
    });

    const result = resolver.resolve(input, []);

    expect(result).toBe('L2');
  });

  it('should resolve to L1 for same trade under Aggressive maxSingleTradePercent (20%)', () => {
    const input = buildInput({
      mandate: {
        ...BALANCED_MANDATE,
        maxSingleTradePercent: 20,
        monthlyTurnoverCapPercent: 40,
      },
      proposedTrades: [
        {
          symbol: 'AAPL',
          assetClass: 'EQUITY',
          side: 'BUY',
          quantityOrAmountCents: 6_000_00, // 6% of $100k portfolio < 20% limit
          targetWeightPercent: 6,
          rationale: 'Aggressive-within buy',
        },
      ],
    });

    const result = resolver.resolve(input, []);

    expect(result).toBe('L1');
  });

  it('should resolve to L2 when monthly turnover would exceed cap', () => {
    const input = buildInput({
      proposedTrades: [
        {
          symbol: 'AAPL',
          assetClass: 'EQUITY',
          side: 'BUY',
          quantityOrAmountCents: 9_000_00, // within single trade limit (10%)
          targetWeightPercent: 9,
          rationale: 'Buy 1',
        },
        {
          symbol: 'GOOG',
          assetClass: 'EQUITY',
          side: 'BUY',
          quantityOrAmountCents: 9_000_00,
          targetWeightPercent: 9,
          rationale: 'Buy 2',
        },
        {
          symbol: 'MSFT',
          assetClass: 'EQUITY',
          side: 'BUY',
          quantityOrAmountCents: 9_000_00,
          targetWeightPercent: 9,
          rationale: 'Buy 3',
        },
      ],
    });

    // Total turnover: 27% > 25% Balanced cap
    const result = resolver.resolve(input, []);

    expect(result).toBe('L2');
  });

  it('should resolve to L1 when total turnover is within cap', () => {
    const input = buildInput({
      proposedTrades: [
        {
          symbol: 'AAPL',
          assetClass: 'EQUITY',
          side: 'BUY',
          quantityOrAmountCents: 8_000_00,
          targetWeightPercent: 8,
          rationale: 'Buy 1',
        },
        {
          symbol: 'GOOG',
          assetClass: 'EQUITY',
          side: 'BUY',
          quantityOrAmountCents: 8_000_00,
          targetWeightPercent: 8,
          rationale: 'Buy 2',
        },
      ],
    });

    // Total turnover: 16% < 25% Balanced cap, each trade 8% < 10% single trade limit
    const result = resolver.resolve(input, []);

    expect(result).toBe('L1');
  });
});
