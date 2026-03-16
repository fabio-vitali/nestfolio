jest.mock('@nestfolio/event-processor', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },

  withMethodLogging: jest.fn((_className: string) =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),

}));
import { SafetyChecksService } from '../src/services/safety-checks.service';

describe('SafetyChecksService', () => {
  let service: SafetyChecksService;
  let mockRepository: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRepository = {
      getConflictingStagedOrders: jest.fn().mockResolvedValue([]),
      getCoolDown: jest.fn().mockResolvedValue(null),
      getStagedOrders: jest.fn().mockResolvedValue([]),
    };
    service = new SafetyChecksService(mockRepository);
  });

  describe('checkReconciliationLock', () => {
    it('should always return false in phase 2', async () => {
      const result = await service.checkReconciliationLock('t1');
      expect(result).toBe(false);
    });
  });

  describe('checkConflictingStagedOrders', () => {
    it('should return false when no conflicts', async () => {
      mockRepository.getConflictingStagedOrders.mockResolvedValue([]);

      const result = await service.checkConflictingStagedOrders('t1', ['VTI']);

      expect(result).toBe(false);
    });

    it('should return true when conflicts exist', async () => {
      mockRepository.getConflictingStagedOrders.mockResolvedValue([
        { orderId: 'ord-1', proposedTrades: [{ symbol: 'VTI' }] },
      ]);

      const result = await service.checkConflictingStagedOrders('t1', ['VTI']);

      expect(result).toBe(true);
    });
  });

  describe('checkCoolDown', () => {
    it('should return false when no cooldown exists', async () => {
      mockRepository.getCoolDown.mockResolvedValue(null);

      const result = await service.checkCoolDown('t1', ['VTI']);

      expect(result).toBe(false);
    });

    it('should return true when active cooldown exists', async () => {
      const futureDate = new Date(Date.now() + 60000).toISOString();
      mockRepository.getCoolDown.mockResolvedValue({ expiresAt: futureDate });

      const result = await service.checkCoolDown('t1', ['VTI']);

      expect(result).toBe(true);
    });

    it('should return false when cooldown has expired', async () => {
      const pastDate = new Date(Date.now() - 60000).toISOString();
      mockRepository.getCoolDown.mockResolvedValue({ expiresAt: pastDate });

      const result = await service.checkCoolDown('t1', ['VTI']);

      expect(result).toBe(false);
    });
  });

  describe('runAllChecks', () => {
    const proposedTrades = [
      { symbol: 'VTI', assetClass: 'EQUITY', side: 'BUY' as const, quantityOrAmountCents: 10, targetWeightPercent: 50, rationale: 'Buy VTI' },
    ];

    it('should pass when all checks clear', async () => {
      const result = await service.runAllChecks('t1', proposedTrades);

      expect(result.passed).toBe(true);
      expect(result.checks).toEqual({
        reconciliationLock: false,
        conflictingStagedOrders: false,
        coolDown: false,
      });
    });

    it('should fail when conflicting staged orders exist', async () => {
      mockRepository.getConflictingStagedOrders.mockResolvedValue([
        { orderId: 'ord-1', proposedTrades: [{ symbol: 'VTI' }] },
      ]);

      const result = await service.runAllChecks('t1', proposedTrades);

      expect(result.passed).toBe(false);
      expect(result.reason).toContain('Conflicting staged orders');
      expect(result.checks.conflictingStagedOrders).toBe(true);
    });

    it('should fail when cooldown is active', async () => {
      const futureDate = new Date(Date.now() + 60000).toISOString();
      mockRepository.getCoolDown.mockResolvedValue({ expiresAt: futureDate });

      const result = await service.runAllChecks('t1', proposedTrades);

      expect(result.passed).toBe(false);
      expect(result.reason).toContain('Cool down');
      expect(result.checks.coolDown).toBe(true);
    });
  });
});
