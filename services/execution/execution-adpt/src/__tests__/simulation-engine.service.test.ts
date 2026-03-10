jest.mock('@nestfolio/platform-core', () => ({
  getUUID: jest.fn().mockReturnValue('test-trade-id'),
  getTime: jest.fn().mockReturnValue('2025-01-01T00:00:00.000Z'),
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  NotRetryableError: class NotRetryableError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'NotRetryableError';
    }
  },
}));

jest.mock('@nestfolio/lambda-utils', () => ({
  withMethodLogging: jest.fn((_className: string) =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),
}));

import { SimulationEngineService } from '../services/simulation-engine.service';
import { MarketDataService } from '../services/market-data.service';
import { VirtualLedgerRepository } from '../repositories/virtual-ledger.repository';

describe('SimulationEngineService', () => {
  let engine: SimulationEngineService;
  let mockRepo: jest.Mocked<VirtualLedgerRepository>;
  let mockMarketData: jest.Mocked<MarketDataService>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockRepo = {
      getCashBalance: jest.fn(),
      getPosition: jest.fn(),
      executeTrade: jest.fn(),
      initializeCashBalance: jest.fn(),
      updateCashBalanceConditional: jest.fn(),
      getAllPositions: jest.fn(),
      getTradeHistory: jest.fn(),
      createSnapshot: jest.fn(),
      getLatestSnapshot: jest.fn(),
    } as unknown as jest.Mocked<VirtualLedgerRepository>;

    mockMarketData = {
      getPrice: jest.fn(),
      getAllPrices: jest.fn(),
    } as unknown as jest.Mocked<MarketDataService>;

    engine = new SimulationEngineService(mockRepo, mockMarketData);
  });

  describe('processOrderSubmitted', () => {
    it('should fill a BUY order when sufficient cash is available', async () => {
      mockMarketData.getPrice.mockReturnValue(250.50);
      mockRepo.getCashBalance.mockResolvedValue({ balance: 100000 });
      mockRepo.getPosition.mockResolvedValue(null);
      mockRepo.executeTrade.mockResolvedValue(undefined);

      const result = await engine.processOrderSubmitted(
        't-1', 'u-1', 'order-1', 'VTI', 'BUY', 10,
      );

      expect(result.status).toBe('FILLED');
      expect(result.orderId).toBe('order-1');
      expect(result.fillPrice).toBe(250.50);
      expect(result.fillQuantity).toBe(10);
      expect(result.totalValue).toBe(2505);

      expect(mockRepo.executeTrade).toHaveBeenCalledWith('t-1', 'u-1', {
        tradeId: 'test-trade-id',
        orderId: 'order-1',
        symbol: 'VTI',
        side: 'BUY',
        quantity: 10,
        fillPrice: 250.50,
        totalValue: 2505,
        cashBefore: 100000,
        cashAfter: 97495,
      });
    });

    it('should reject a BUY order when insufficient cash', async () => {
      mockMarketData.getPrice.mockReturnValue(250.50);
      mockRepo.getCashBalance.mockResolvedValue({ balance: 1000 });
      mockRepo.getPosition.mockResolvedValue(null);

      const result = await engine.processOrderSubmitted(
        't-1', 'u-1', 'order-1', 'VTI', 'BUY', 10,
      );

      expect(result.status).toBe('REJECTED');
      expect(result.rejectReason).toContain('Insufficient cash');
      expect(result.rejectReason).toContain('1000');
      expect(result.rejectReason).toContain('2505');
      expect(mockRepo.executeTrade).not.toHaveBeenCalled();
    });

    it('should fill a SELL order when sufficient position exists', async () => {
      mockMarketData.getPrice.mockReturnValue(250.50);
      mockRepo.getCashBalance.mockResolvedValue({ balance: 50000 });
      mockRepo.getPosition.mockResolvedValue({ quantity: 20 });
      mockRepo.executeTrade.mockResolvedValue(undefined);

      const result = await engine.processOrderSubmitted(
        't-1', 'u-1', 'order-1', 'VTI', 'SELL', 5,
      );

      expect(result.status).toBe('FILLED');
      expect(result.fillPrice).toBe(250.50);
      expect(result.fillQuantity).toBe(5);
      expect(result.totalValue).toBe(1252.50);

      expect(mockRepo.executeTrade).toHaveBeenCalledWith('t-1', 'u-1', expect.objectContaining({
        side: 'SELL',
        cashAfter: 51252.50,
      }));
    });

    it('should reject a SELL order when insufficient position', async () => {
      mockMarketData.getPrice.mockReturnValue(250.50);
      mockRepo.getCashBalance.mockResolvedValue({ balance: 50000 });
      mockRepo.getPosition.mockResolvedValue({ quantity: 3 });

      const result = await engine.processOrderSubmitted(
        't-1', 'u-1', 'order-1', 'VTI', 'SELL', 10,
      );

      expect(result.status).toBe('REJECTED');
      expect(result.rejectReason).toContain('Insufficient position');
      expect(result.rejectReason).toContain('3');
      expect(result.rejectReason).toContain('10');
      expect(mockRepo.executeTrade).not.toHaveBeenCalled();
    });

    it('should reject a SELL order when no position exists', async () => {
      mockMarketData.getPrice.mockReturnValue(250.50);
      mockRepo.getCashBalance.mockResolvedValue({ balance: 50000 });
      mockRepo.getPosition.mockResolvedValue(null);

      const result = await engine.processOrderSubmitted(
        't-1', 'u-1', 'order-1', 'VTI', 'SELL', 5,
      );

      expect(result.status).toBe('REJECTED');
      expect(result.rejectReason).toContain('Insufficient position');
      expect(mockRepo.executeTrade).not.toHaveBeenCalled();
    });

    it('should reject order for unknown symbol', async () => {
      mockMarketData.getPrice.mockReturnValue(null);

      const result = await engine.processOrderSubmitted(
        't-1', 'u-1', 'order-1', 'UNKNOWN', 'BUY', 10,
      );

      expect(result.status).toBe('REJECTED');
      expect(result.rejectReason).toContain('Unknown symbol: UNKNOWN');
      expect(mockRepo.getCashBalance).not.toHaveBeenCalled();
      expect(mockRepo.executeTrade).not.toHaveBeenCalled();
    });

    it('should throw NotRetryableError for zero quantity', async () => {
      await expect(
        engine.processOrderSubmitted('t-1', 'u-1', 'order-1', 'VTI', 'BUY', 0),
      ).rejects.toThrow('Invalid quantity: 0');

      expect(mockMarketData.getPrice).not.toHaveBeenCalled();
      expect(mockRepo.executeTrade).not.toHaveBeenCalled();
    });

    it('should throw NotRetryableError for negative quantity', async () => {
      await expect(
        engine.processOrderSubmitted('t-1', 'u-1', 'order-1', 'VTI', 'SELL', -5),
      ).rejects.toThrow('Invalid quantity: -5');

      expect(mockMarketData.getPrice).not.toHaveBeenCalled();
      expect(mockRepo.executeTrade).not.toHaveBeenCalled();
    });

    it('should handle BUY with no existing cash balance (defaults to 0)', async () => {
      mockMarketData.getPrice.mockReturnValue(10);
      mockRepo.getCashBalance.mockResolvedValue(null);
      mockRepo.getPosition.mockResolvedValue(null);

      const result = await engine.processOrderSubmitted(
        't-1', 'u-1', 'order-1', 'VTI', 'BUY', 1,
      );

      expect(result.status).toBe('REJECTED');
      expect(result.rejectReason).toContain('Insufficient cash');
    });
  });

  describe('processWithdrawal', () => {
    it('should complete withdrawal when sufficient cash', async () => {
      mockRepo.getCashBalance.mockResolvedValue({ balance: 100000, version: 3 });
      mockRepo.updateCashBalanceConditional.mockResolvedValue(undefined);

      const result = await engine.processWithdrawal('t-1', 'u-1', 'w-1', 5000);

      expect(result.status).toBe('COMPLETED');
      expect(result.reason).toBeUndefined();
      expect(mockRepo.updateCashBalanceConditional).toHaveBeenCalledWith('t-1', 'u-1', 'USD', 95000, 3);
    });

    it('should reject withdrawal when insufficient cash', async () => {
      mockRepo.getCashBalance.mockResolvedValue({ balance: 1000 });

      const result = await engine.processWithdrawal('t-1', 'u-1', 'w-1', 5000);

      expect(result.status).toBe('REJECTED');
      expect(result.reason).toContain('Insufficient cash');
      expect(result.reason).toContain('1000');
      expect(result.reason).toContain('5000');
      expect(mockRepo.updateCashBalanceConditional).not.toHaveBeenCalled();
    });

    it('should reject withdrawal when no cash balance exists', async () => {
      mockRepo.getCashBalance.mockResolvedValue(null);

      const result = await engine.processWithdrawal('t-1', 'u-1', 'w-1', 5000);

      expect(result.status).toBe('REJECTED');
      expect(result.reason).toContain('Insufficient cash');
      expect(mockRepo.updateCashBalanceConditional).not.toHaveBeenCalled();
    });
  });

  describe('initializeAccount', () => {
    it('should initialize with default balance of $100,000', async () => {
      mockRepo.initializeCashBalance.mockResolvedValue(undefined);

      await engine.initializeAccount('t-1', 'u-1');

      expect(mockRepo.initializeCashBalance).toHaveBeenCalledWith('t-1', 'u-1', 'USD', 100000);
    });

    it('should initialize with custom balance', async () => {
      mockRepo.initializeCashBalance.mockResolvedValue(undefined);

      await engine.initializeAccount('t-1', 'u-1', 50000);

      expect(mockRepo.initializeCashBalance).toHaveBeenCalledWith('t-1', 'u-1', 'USD', 50000);
    });
  });
});
