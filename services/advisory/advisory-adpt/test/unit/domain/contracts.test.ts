import { ProposedTradeSchema } from '../../../src/domain/contracts';

describe('advisory-adpt contracts', () => {
  it('ProposedTradeSchema parses a BUY trade', () => {
    const parsed = ProposedTradeSchema.parse({
      symbol: 'VTI', assetClass: 'EQUITY', side: 'BUY',
      quantityOrAmountCents: 500000, targetWeightPercent: 60, rationale: 'core equity',
    });
    expect(parsed.symbol).toBe('VTI');
    expect(parsed.side).toBe('BUY');
  });

  it('ProposedTradeSchema rejects an invalid side', () => {
    expect(() => ProposedTradeSchema.parse({
      symbol: 'VTI', assetClass: 'EQUITY', side: 'HOLD',
      quantityOrAmountCents: 1, targetWeightPercent: 1, rationale: 'x',
    })).toThrow();
  });
});
