jest.mock('@nestfolio/platform-core', () => ({
  getUUID: jest.fn().mockReturnValue('test-uuid'),
  getTime: jest.fn().mockReturnValue('2025-01-01T00:00:00.000Z'),
  log: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

jest.mock('@nestfolio/domain-core', () => ({}));

import { OrderLifecycleService } from '../services/order-lifecycle.service';

describe('OrderLifecycleService', () => {
  let service: OrderLifecycleService;
  let mockRepository: any;
  let mockSafetyChecks: any;
  let mockMarketHours: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockRepository = {
      createOrder: jest.fn().mockResolvedValue(undefined),
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
    context: { tenantId: 't1' },
    ...overrides,
  });

  describe('processApprovedDecision', () => {
    it('should submit order immediately when market is open and safety checks pass', async () => {
      await service.processApprovedDecision(buildEvent() as any);

      expect(mockRepository.createOrder).toHaveBeenCalledWith('t1', 'test-uuid', 'dp-1', expect.any(Array));
      expect(mockSafetyChecks.runAllChecks).toHaveBeenCalledWith('t1', expect.any(Array));
      expect(mockMarketHours.isMarketOpen).toHaveBeenCalled();
      expect(mockRepository.updateOrderStatus).toHaveBeenCalledWith('t1', 'test-uuid', 'SUBMITTED');
    });

    it('should stage order when market is closed', async () => {
      mockMarketHours.isMarketOpen.mockReturnValue(false);

      await service.processApprovedDecision(buildEvent() as any);

      expect(mockRepository.createOrder).toHaveBeenCalled();
      expect(mockRepository.createStagedOrder).toHaveBeenCalledWith('t1', 'test-uuid', {
        proposedTrades: expect.any(Array),
      });
      expect(mockRepository.updateOrderStatus).toHaveBeenCalledWith('t1', 'test-uuid', 'STAGED');
    });

    it('should reject order when safety checks fail', async () => {
      mockSafetyChecks.runAllChecks.mockResolvedValue({
        passed: false,
        reason: 'Conflicting staged orders exist for the same instruments',
        checks: { reconciliationLock: false, conflictingStagedOrders: true, coolDown: false },
      });

      await service.processApprovedDecision(buildEvent() as any);

      expect(mockRepository.createOrder).toHaveBeenCalled();
      expect(mockRepository.updateOrderStatus).toHaveBeenCalledWith('t1', 'test-uuid', 'REJECTED', {
        reason: 'Conflicting staged orders exist for the same instruments',
      });
      expect(mockMarketHours.isMarketOpen).not.toHaveBeenCalled();
      expect(mockRepository.createStagedOrder).not.toHaveBeenCalled();
    });

    it('should extract tenantId from context', async () => {
      const event = buildEvent({
        context: { tenantId: 'tenant-abc' },
        subject: {
          decisionPacketId: 'dp-2',
          proposedTrades: [],
        },
      });

      await service.processApprovedDecision(event as any);

      expect(mockRepository.createOrder).toHaveBeenCalledWith(
        'tenant-abc',
        'test-uuid',
        'dp-2',
        [],
      );
    });
  });
});
