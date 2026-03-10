import {
  replayEvents,
  INITIAL_PORTFOLIO_STATE,
  type LedgerEntry,
} from '@nestfolio/command-core';
import { portfolioReducer } from '../reducers/portfolio.reducer';

describe('portfolioReducer', () => {
  it('should apply ORDER_FILLED BUY event', () => {
    const entry: LedgerEntry = {
      eventId: 'evt-1',
      eventType: 'ORDER_FILLED',
      payload: {
        orderId: 'o1',
        symbol: 'VTI',
        side: 'BUY',
        quantity: 10,
        fillPrice: 245.50,
        filledAt: '2025-01-01T00:00:00.000Z',
      },
      timestamp: '2025-01-01T00:00:00.000Z',
      sequenceNo: 1,
    };

    const result = portfolioReducer(INITIAL_PORTFOLIO_STATE, entry);

    expect(result.positions['VTI']).toBeDefined();
    expect(result.positions['VTI'].quantity).toBe(10);
    expect(result.positions['VTI'].averageCostBasis).toBeCloseTo(245.50);
    expect(result.cashBalanceCents).toBe(INITIAL_PORTFOLIO_STATE.cashBalanceCents - 245500);
  });

  it('should apply ORDER_PARTIALLY_FILLED event', () => {
    const entry: LedgerEntry = {
      eventId: 'evt-1',
      eventType: 'ORDER_PARTIALLY_FILLED',
      payload: {
        orderId: 'o1',
        symbol: 'SPY',
        side: 'BUY',
        quantity: 3,
        fillPrice: 512.30,
        filledAt: '2025-01-01T00:00:00.000Z',
      },
      timestamp: '2025-01-01T00:00:00.000Z',
      sequenceNo: 1,
    };

    const result = portfolioReducer(INITIAL_PORTFOLIO_STATE, entry);

    expect(result.positions['SPY'].quantity).toBe(3);
    expect(result.positions['SPY'].averageCostBasis).toBeCloseTo(512.30);
  });

  it('should apply DEPOSIT_DETECTED event', () => {
    const entry: LedgerEntry = {
      eventId: 'evt-1',
      eventType: 'DEPOSIT_DETECTED',
      payload: { amountCents: 500000 },
      timestamp: '2025-01-01T00:00:00.000Z',
      sequenceNo: 1,
    };

    const result = portfolioReducer(INITIAL_PORTFOLIO_STATE, entry);

    expect(result.cashBalanceCents).toBe(INITIAL_PORTFOLIO_STATE.cashBalanceCents + 500000);
  });

  it('should apply WITHDRAWAL_COMPLETED event', () => {
    const entry: LedgerEntry = {
      eventId: 'evt-1',
      eventType: 'WITHDRAWAL_COMPLETED',
      payload: { amountCents: 200000 },
      timestamp: '2025-01-01T00:00:00.000Z',
      sequenceNo: 1,
    };

    const result = portfolioReducer(INITIAL_PORTFOLIO_STATE, entry);

    expect(result.cashBalanceCents).toBe(INITIAL_PORTFOLIO_STATE.cashBalanceCents - 200000);
  });

  it('should ignore ORDER_REJECTED and ORDER_CANCELLED events', () => {
    const rejected: LedgerEntry = {
      eventId: 'evt-1',
      eventType: 'ORDER_REJECTED',
      payload: { orderId: 'o1', reason: 'Insufficient funds' },
      timestamp: '2025-01-01T00:00:00.000Z',
      sequenceNo: 1,
    };
    const cancelled: LedgerEntry = {
      eventId: 'evt-2',
      eventType: 'ORDER_CANCELLED',
      payload: { orderId: 'o1' },
      timestamp: '2025-01-01T00:00:00.000Z',
      sequenceNo: 2,
    };

    const afterRejected = portfolioReducer(INITIAL_PORTFOLIO_STATE, rejected);
    const afterCancelled = portfolioReducer(INITIAL_PORTFOLIO_STATE, cancelled);

    expect(afterRejected).toEqual(INITIAL_PORTFOLIO_STATE);
    expect(afterCancelled).toEqual(INITIAL_PORTFOLIO_STATE);
  });

  it('should replay multiple events in sequence order', () => {
    const events: LedgerEntry[] = [
      {
        eventId: 'evt-3',
        eventType: 'ORDER_FILLED',
        payload: { orderId: 'o2', symbol: 'SPY', side: 'BUY', quantity: 5, fillPrice: 512.30, filledAt: '2025-01-02T00:00:00.000Z' },
        timestamp: '2025-01-02T00:00:00.000Z',
        sequenceNo: 3,
      },
      {
        eventId: 'evt-1',
        eventType: 'ORDER_FILLED',
        payload: { orderId: 'o1', symbol: 'VTI', side: 'BUY', quantity: 10, fillPrice: 245.50, filledAt: '2025-01-01T00:00:00.000Z' },
        timestamp: '2025-01-01T00:00:00.000Z',
        sequenceNo: 1,
      },
      {
        eventId: 'evt-2',
        eventType: 'DEPOSIT_DETECTED',
        payload: { amountCents: 500000 },
        timestamp: '2025-01-01T12:00:00.000Z',
        sequenceNo: 2,
      },
    ];

    const result = replayEvents(INITIAL_PORTFOLIO_STATE, events, portfolioReducer);

    // Events should be replayed in sequenceNo order: 1, 2, 3
    expect(result.positions['VTI'].quantity).toBe(10);
    expect(result.positions['SPY'].quantity).toBe(5);
    // Cash = 10M - (10 * 245.50 * 100) + 500000 - (5 * 512.30 * 100) = 10M - 245500 + 500000 - 256150
    expect(result.cashBalanceCents).toBe(
      INITIAL_PORTFOLIO_STATE.cashBalanceCents - 245500 + 500000 - 256150,
    );
  });
});
