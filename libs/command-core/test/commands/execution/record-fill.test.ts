import { applyCommand } from '../../../src/command';
import { INITIAL_PORTFOLIO_STATE, type PortfolioState } from '../../../src/state/account-state';
import { RecordFill } from '../../../src/commands/execution/record-fill';

const validBuy = {
  orderId: 'ord-1',
  symbol: 'VTI',
  side: 'BUY' as const,
  quantity: 10,
  fillPrice: 250.5,
  filledAt: '2026-01-15T10:00:00.000Z',
};

const validSell = {
  orderId: 'ord-2',
  symbol: 'VTI',
  side: 'SELL' as const,
  quantity: 5,
  fillPrice: 260.0,
  filledAt: '2026-01-16T10:00:00.000Z',
};

describe('RecordFill', () => {
  it('should have type RecordFill', () => {
    expect(RecordFill.type).toBe('RecordFill');
  });

  describe('BUY', () => {
    it('should add a new position on first buy', () => {
      const result = applyCommand(RecordFill, validBuy, INITIAL_PORTFOLIO_STATE);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const pos = result.value.nextState.positions['VTI'];
      expect(pos.quantity).toBe(10);
      expect(pos.averageCostBasis).toBe(250.5);
      expect(pos.totalCostBasis).toBe(2505);
      expect(pos.lastFillPrice).toBe(250.5);
    });

    it('should compute weighted average cost on second buy', () => {
      const firstResult = applyCommand(RecordFill, validBuy, INITIAL_PORTFOLIO_STATE);
      expect(firstResult.ok).toBe(true);
      if (!firstResult.ok) return;

      const secondBuy = { ...validBuy, orderId: 'ord-2', quantity: 10, fillPrice: 260.5 };
      const result = applyCommand(RecordFill, secondBuy, firstResult.value.nextState);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const pos = result.value.nextState.positions['VTI'];
      expect(pos.quantity).toBe(20);
      expect(pos.totalCostBasis).toBe(2505 + 2605);
      expect(pos.averageCostBasis).toBeCloseTo(255.5);
    });

    it('should decrease cash balance on buy', () => {
      const result = applyCommand(RecordFill, validBuy, INITIAL_PORTFOLIO_STATE);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // 10 * 250.5 * 100 = 250500 cents
      expect(result.value.nextState.cashBalanceCents).toBe(10_000_000 - 250_500);
    });
  });

  describe('SELL', () => {
    const stateWithPosition: PortfolioState = {
      ...INITIAL_PORTFOLIO_STATE,
      positions: {
        VTI: {
          symbol: 'VTI',
          quantity: 10,
          averageCostBasis: 250.5,
          totalCostBasis: 2505,
          lastFillPrice: 250.5,
        },
      },
    };

    it('should reduce position on sell', () => {
      const result = applyCommand(RecordFill, validSell, stateWithPosition);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const pos = result.value.nextState.positions['VTI'];
      expect(pos.quantity).toBe(5);
      expect(pos.lastFillPrice).toBe(260.0);
    });

    it('should preserve average cost basis on partial sell', () => {
      const result = applyCommand(RecordFill, validSell, stateWithPosition);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const pos = result.value.nextState.positions['VTI'];
      expect(pos.averageCostBasis).toBe(250.5);
      expect(pos.totalCostBasis).toBeCloseTo(250.5 * 5);
    });

    it('should zero out cost basis on full sell', () => {
      const fullSell = { ...validSell, quantity: 10 };
      const result = applyCommand(RecordFill, fullSell, stateWithPosition);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const pos = result.value.nextState.positions['VTI'];
      expect(pos.quantity).toBe(0);
      expect(pos.totalCostBasis).toBe(0);
      expect(pos.averageCostBasis).toBe(0);
    });

    it('should increase cash balance on sell', () => {
      const result = applyCommand(RecordFill, validSell, stateWithPosition);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // 5 * 260 * 100 = 130000 cents
      expect(result.value.nextState.cashBalanceCents).toBe(10_000_000 + 130_000);
    });

    it('should return invariant error when selling more than held', () => {
      const oversell = { ...validSell, quantity: 15 };
      const result = applyCommand(RecordFill, oversell, stateWithPosition);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('invariant');
        expect(result.error.message).toContain('Cannot sell');
      }
    });
  });

  describe('validation', () => {
    it('should reject zero quantity', () => {
      const result = applyCommand(
        RecordFill,
        { ...validBuy, quantity: 0 },
        INITIAL_PORTFOLIO_STATE,
      );
      expect(result.ok).toBe(false);
    });

    it('should reject negative fill price', () => {
      const result = applyCommand(
        RecordFill,
        { ...validBuy, fillPrice: -10 },
        INITIAL_PORTFOLIO_STATE,
      );
      expect(result.ok).toBe(false);
    });

    it('should reject missing symbol', () => {
      const result = applyCommand(
        RecordFill,
        { ...validBuy, symbol: '' },
        INITIAL_PORTFOLIO_STATE,
      );
      expect(result.ok).toBe(false);
    });
  });
});
