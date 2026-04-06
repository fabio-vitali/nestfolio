jest.mock('@nestfolio/event-processor', () => ({
  getTime: jest.fn().mockReturnValue('2025-01-01T00:00:00.000Z'),
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },

  withMethodLogging: jest.fn((_className: string) =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),

}));
import { OrderLifecycleService } from '../../src/services/order-lifecycle.service';

describe('OrderLifecycleService', () => {
  let service: OrderLifecycleService;
  let mockRepository: any;
  let mockSafetyChecks: any;
  let mockMarketHours: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockRepository = {
      createOrder: jest.fn().mockResolvedValue(true),
      updateOrderStatus: jest.fn().mockResolvedValue(undefined),
      createStagedOrder: jest.fn().mockResolvedValue(undefined),
    };

    mockSafetyChecks = {
      runAllChecks: jest.fn().mockResolvedValue({
        passed: true,
        checks: { reconciliationLock: false, conflictingStagedOrders: false, coolDown: false },
      }),
    };

    mockMarketHours = {
      isMarketOpen: jest.fn().mockReturnValue(true),
    };

    service = new OrderLifecycleService(mockRepository, mockSafetyChecks, mockMarketHours);
  });

  const defaultCtx = { tenantId: 't1', userId: 'u1', region: 'us-east-1' };

  const buildEvent = (overrides?: Record<string, unknown>) => ({
    id: 'evt-1',
    type: 'DECISION_APPROVED',
    timestamp: '2025-01-01T00:00:00.000Z',
    subject: {
      tenantId: 't1',
      decisionPacketId: 'dp-1',
      proposedTrades: [
        { symbol: 'VTI', assetClass: 'EQUITY', side: 'BUY', quantityOrAmountCents: 10, targetWeightPercent: 50, rationale: 'Buy VTI' },
      ],
    },
    context: defaultCtx,
    ...overrides,
  });

  describe('processApprovedDecision', () => {
    it('should submit order immediately when market is open and safety checks pass', async () => {
      await service.processApprovedDecision(buildEvent() as any);

      expect(mockRepository.createOrder).toHaveBeenCalledWith('evt-1', 'dp-1', expect.any(Array), defaultCtx, 'evt-1');
      expect(mockSafetyChecks.runAllChecks).toHaveBeenCalledWith('t1', expect.any(Array));
      expect(mockMarketHours.isMarketOpen).toHaveBeenCalled();
      expect(mockRepository.updateOrderStatus).toHaveBeenCalledWith('t1', 'evt-1', 'SUBMITTED');
    });

    it('should stage order when market is closed', async () => {
      mockMarketHours.isMarketOpen.mockReturnValue(false);

      await service.processApprovedDecision(buildEvent() as any);

      expect(mockRepository.createOrder).toHaveBeenCalled();
      expect(mockRepository.createStagedOrder).toHaveBeenCalledWith('evt-1', {
        proposedTrades: expect.any(Array),
      }, defaultCtx);
      expect(mockRepository.updateOrderStatus).toHaveBeenCalledWith('t1', 'evt-1', 'STAGED');
    });

    it('should reject order when safety checks fail', async () => {
      mockSafetyChecks.runAllChecks.mockResolvedValue({
        passed: false,
        reason: 'Conflicting staged orders exist for the same instruments',
        checks: { reconciliationLock: false, conflictingStagedOrders: true, coolDown: false },
      });

      await service.processApprovedDecision(buildEvent() as any);

      expect(mockRepository.createOrder).toHaveBeenCalled();
      expect(mockRepository.updateOrderStatus).toHaveBeenCalledWith('t1', 'evt-1', 'REJECTED', {
        reason: 'Conflicting staged orders exist for the same instruments',
      });
      expect(mockMarketHours.isMarketOpen).not.toHaveBeenCalled();
      expect(mockRepository.createStagedOrder).not.toHaveBeenCalled();
    });

    it('should extract tenantId from context', async () => {
      const customCtx = { tenantId: 'tenant-abc', userId: 'u2', region: 'us-east-1' };
      const event = buildEvent({
        context: customCtx,
        subject: {
          decisionPacketId: 'dp-2',
          proposedTrades: [],
        },
      });

      await service.processApprovedDecision(event as any);

      expect(mockRepository.createOrder).toHaveBeenCalledWith(
        'evt-1',
        'dp-2',
        [],
        customCtx,
        'evt-1',
      );
    });
  });
});
