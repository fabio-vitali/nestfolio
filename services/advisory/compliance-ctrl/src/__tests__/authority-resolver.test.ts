import { AuthorityResolver } from '../rules/authority-resolver';
import type { ComplianceInput, Violation } from '../rules/rule-engine';

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

  it('should resolve to L1 for DISCRETIONARY mandate with no violations and small trades', () => {
    const result = resolver.resolve(buildInput(), []);

    expect(result).toBe('L1');
  });

  it('should resolve to L2 for ADVISORY mandate', () => {
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

  it('should resolve to L2 for large trades even with DISCRETIONARY mandate', () => {
    const input = buildInput({
      proposedTrades: [
        {
          symbol: 'AAPL',
          assetClass: 'EQUITY',
          side: 'BUY',
          quantityOrAmountCents: 60_000_00, // $60,000 > $50,000 threshold
          targetWeightPercent: 60,
          rationale: 'Large buy',
        },
      ],
    });

    const result = resolver.resolve(input, []);

    expect(result).toBe('L2');
  });

  it('should resolve to L1 for trade just below threshold', () => {
    const input = buildInput({
      proposedTrades: [
        {
          symbol: 'AAPL',
          assetClass: 'EQUITY',
          side: 'BUY',
          quantityOrAmountCents: 49_999_99, // Just below $50,000
          targetWeightPercent: 49,
          rationale: 'Near threshold',
        },
      ],
    });

    const result = resolver.resolve(input, []);

    expect(result).toBe('L1');
  });
});
