import { INITIAL_ACCOUNT_STATE } from '@nestfolio/command-core';
import { accountReducer } from '../../src/reducers/account.reducer';

describe('accountReducer', () => {
  it('applies DEPOSIT_DETECTED', () => {
    const next = accountReducer(INITIAL_ACCOUNT_STATE, {
      eventId: 'e1', eventType: 'DEPOSIT_DETECTED', sequenceNo: 1,
      timestamp: '2026-03-12T00:00:00Z',
      payload: { depositId: 'd1', amountCents: 500_00, depositedAt: '2026-03-12T00:00:00Z' },
    });
    expect(next.cashBalanceCents).toBe(INITIAL_ACCOUNT_STATE.cashBalanceCents + 500_00);
  });

  it('applies WITHDRAWAL_COMPLETED', () => {
    const next = accountReducer(INITIAL_ACCOUNT_STATE, {
      eventId: 'e2', eventType: 'WITHDRAWAL_COMPLETED', sequenceNo: 1,
      timestamp: '2026-03-12T00:00:00Z',
      payload: { withdrawalId: 'w1', amountCents: 200_00, completedAt: '2026-03-12T00:00:00Z' },
    });
    expect(next.cashBalanceCents).toBe(INITIAL_ACCOUNT_STATE.cashBalanceCents - 200_00);
  });

  it('applies ORDER_FILLED (BUY)', () => {
    const next = accountReducer(INITIAL_ACCOUNT_STATE, {
      eventId: 'e3', eventType: 'ORDER_FILLED', sequenceNo: 1,
      timestamp: '2026-03-12T00:00:00Z',
      payload: { orderId: 'o1', symbol: 'AAPL', side: 'BUY', quantity: 10, fillPrice: 150_00, filledAt: '2026-03-12T00:00:00Z' },
    });
    expect(next.positions['AAPL']).toBeDefined();
    expect(next.positions['AAPL'].quantity).toBe(10);
    expect(next.cashBalanceCents).toBe(INITIAL_ACCOUNT_STATE.cashBalanceCents - 10 * 150_00 * 100);
  });

  it('applies ORDER_FILLED (SELL)', () => {
    const stateWithPosition = {
      ...INITIAL_ACCOUNT_STATE,
      positions: { AAPL: { symbol: 'AAPL', quantity: 10, averageCostBasis: 150_00, totalCostBasis: 1_500_00, lastFillPrice: 150_00 } },
    };
    const next = accountReducer(stateWithPosition, {
      eventId: 'e4', eventType: 'ORDER_FILLED', sequenceNo: 1,
      timestamp: '2026-03-12T00:00:00Z',
      payload: { orderId: 'o2', symbol: 'AAPL', side: 'SELL', quantity: 5, fillPrice: 160_00, filledAt: '2026-03-12T00:00:00Z' },
    });
    expect(next.positions['AAPL'].quantity).toBe(5);
    expect(next.cashBalanceCents).toBe(stateWithPosition.cashBalanceCents + 5 * 160_00 * 100);
  });

  it('applies CORPORATE_ACTION_PROCESSED (stock split)', () => {
    const stateWithPosition = {
      ...INITIAL_ACCOUNT_STATE,
      positions: { AAPL: { symbol: 'AAPL', quantity: 100, averageCostBasis: 150, totalCostBasis: 15000, lastFillPrice: 150 } },
    };
    const next = accountReducer(stateWithPosition, {
      eventId: 'e5', eventType: 'CORPORATE_ACTION_PROCESSED', sequenceNo: 1,
      timestamp: '2026-03-12T00:00:00Z',
      payload: { actionId: 'ca1', symbol: 'AAPL', actionType: 'STOCK_SPLIT', quantityMultiplier: 2, costBasisDivisor: 2, appliedAt: '2026-03-12T00:00:00Z' },
    });
    expect(next.positions['AAPL'].quantity).toBe(200);
    expect(next.positions['AAPL'].averageCostBasis).toBe(75);
  });

  it('passes through ORDER_REJECTED unchanged', () => {
    const next = accountReducer(INITIAL_ACCOUNT_STATE, {
      eventId: 'e6', eventType: 'ORDER_REJECTED', sequenceNo: 1,
      timestamp: '2026-03-12T00:00:00Z',
      payload: { orderId: 'o3', reason: 'insufficient funds' },
    });
    expect(next).toEqual(INITIAL_ACCOUNT_STATE);
  });

  it('passes through ORDER_CANCELLED unchanged', () => {
    const next = accountReducer(INITIAL_ACCOUNT_STATE, {
      eventId: 'e7', eventType: 'ORDER_CANCELLED', sequenceNo: 1,
      timestamp: '2026-03-12T00:00:00Z',
      payload: { orderId: 'o4', symbol: 'AAPL', reason: 'user request', cancelledAt: '2026-03-12T00:00:00Z' },
    });
    expect(next).toEqual(INITIAL_ACCOUNT_STATE);
  });
});
