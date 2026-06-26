jest.mock('@nestfolio/event-processor', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },

  withMethodLogging: jest.fn((_className: string) =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),

}));
import { SafetyChecksService } from '../../src/services/safety-checks.service';

describe('SafetyChecksService', () => {
  let service: SafetyChecksService;
  let mockRepository: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRepository = {
      getConflictingStagedOrders: jest.fn().mockResolvedValue([]),
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

  describe('runAllChecks', () => {
    const instruments = ['VTI'];

    it('should pass when all checks clear', async () => {
      const result = await service.runAllChecks('t1', instruments);

      expect(result.passed).toBe(true);
      expect(result.checks).toEqual({
        reconciliationLock: false,
        conflictingStagedOrders: false,
      });
    });

    it('should fail when conflicting staged orders exist', async () => {
      mockRepository.getConflictingStagedOrders.mockResolvedValue([
        { orderId: 'ord-1', proposedTrades: [{ symbol: 'VTI' }] },
      ]);

      const result = await service.runAllChecks('t1', instruments);

      expect(result.passed).toBe(false);
      expect(result.reason).toContain('Conflicting staged orders');
      expect(result.checks.conflictingStagedOrders).toBe(true);
    });
  });
});
