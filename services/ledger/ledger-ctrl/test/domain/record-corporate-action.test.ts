import { applyCommand } from '@nestfolio/command-core';
import { RecordCorporateAction } from '../../src/domain/record-corporate-action';
import { type AccountState, INITIAL_ACCOUNT_STATE } from '../../src/domain/account-state';

describe('RecordCorporateAction', () => {
  const stateWithPosition: AccountState = {
    ...INITIAL_ACCOUNT_STATE,
    positions: {
      AAPL: { symbol: 'AAPL', quantity: 100, averageCostBasis: 150, totalCostBasis: 15000, lastFillPrice: 150 },
    },
  };

  it('applies a 2:1 stock split', () => {
    const result = applyCommand(RecordCorporateAction, {
      actionId: 'ca-1',
      symbol: 'AAPL',
      actionType: 'STOCK_SPLIT',
      quantityMultiplier: 2,
      costBasisDivisor: 2,
      appliedAt: '2026-03-12T00:00:00Z',
    }, stateWithPosition);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.nextState.positions['AAPL'].quantity).toBe(200);
      expect(result.value.nextState.positions['AAPL'].averageCostBasis).toBe(75);
      expect(result.value.nextState.positions['AAPL'].totalCostBasis).toBe(15000);
      expect(result.value.nextState.cashBalanceCents).toBe(INITIAL_ACCOUNT_STATE.cashBalanceCents);
    }
  });

  it('applies a cash dividend', () => {
    const result = applyCommand(RecordCorporateAction, {
      actionId: 'ca-2',
      symbol: 'AAPL',
      actionType: 'DIVIDEND',
      dividendPerShareCents: 50,
      appliedAt: '2026-03-12T00:00:00Z',
    }, stateWithPosition);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.nextState.cashBalanceCents).toBe(INITIAL_ACCOUNT_STATE.cashBalanceCents + 5000);
      expect(result.value.nextState.positions['AAPL'].quantity).toBe(100);
    }
  });

  it('fails for unknown symbol', () => {
    const result = applyCommand(RecordCorporateAction, {
      actionId: 'ca-3',
      symbol: 'UNKNOWN',
      actionType: 'STOCK_SPLIT',
      quantityMultiplier: 2,
      costBasisDivisor: 2,
      appliedAt: '2026-03-12T00:00:00Z',
    }, stateWithPosition);

    expect(result.ok).toBe(false);
  });
});
