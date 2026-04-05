jest.mock('@nestfolio/event-processor', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

import { AlpacaOrdersService } from '../../src/services/alpaca-orders.service';
import type { AlpacaClient } from '../../src/clients/alpaca.client';
import type { OrderMappingRepository } from '../../src/repositories/order-mapping.repository';

const mockClient = {
  submitOrder: jest.fn(),
} as unknown as AlpacaClient;

const mockOrderRepo = {
  createMapping: jest.fn(),
  getByNestfolioOrderId: jest.fn(),
} as unknown as OrderMappingRepository;

const TENANT_ID = 'tenant-1';
const ORDER_ID = 'order-123';
const SYMBOL = 'AAPL';
const SIDE = 'BUY';
const QUANTITY = 10;

describe('AlpacaOrdersService', () => {
  let service: AlpacaOrdersService;

  beforeEach(() => {
    jest.clearAllMocks();
    (mockOrderRepo.createMapping as jest.Mock).mockResolvedValue(undefined);
    service = new AlpacaOrdersService(mockClient, mockOrderRepo);
  });

  describe('submitOrder — success (2xx)', () => {
    it('calls alpaca client with correct order params', async () => {
      (mockClient.submitOrder as jest.Mock).mockResolvedValueOnce({
        status: 200,
        data: { id: 'alpaca-order-789' },
      });

      await service.submitOrder(TENANT_ID, ORDER_ID, SYMBOL, SIDE, QUANTITY);

      expect(mockClient.submitOrder).toHaveBeenCalledWith({
        symbol: SYMBOL,
        qty: QUANTITY,
        side: 'buy',
        type: 'market',
        time_in_force: 'day',
      });
    });

    it('creates order mapping with correct args', async () => {
      (mockClient.submitOrder as jest.Mock).mockResolvedValueOnce({
        status: 201,
        data: { id: 'alpaca-order-789' },
      });

      await service.submitOrder(TENANT_ID, ORDER_ID, SYMBOL, SIDE, QUANTITY);

      expect(mockOrderRepo.createMapping).toHaveBeenCalledWith(
        TENANT_ID, ORDER_ID, 'alpaca-order-789', SYMBOL, SIDE, QUANTITY,
      );
    });

    it('returns AlpacaOrderResult with PLACED status', async () => {
      (mockClient.submitOrder as jest.Mock).mockResolvedValueOnce({
        status: 200,
        data: { id: 'alpaca-order-789' },
      });

      const result = await service.submitOrder(TENANT_ID, ORDER_ID, SYMBOL, SIDE, QUANTITY);

      expect(result).toMatchObject({
        pk: `OrderMapping#${TENANT_ID}#${ORDER_ID}`,
        sk: 'OrderMapping',
        __typename: 'AlpacaOrderResult',
        tenantId: TENANT_ID,
        nestfolioOrderId: ORDER_ID,
        alpacaOrderId: 'alpaca-order-789',
        status: 'PLACED',
        symbol: SYMBOL,
        side: SIDE,
        requestedQty: QUANTITY,
      });
    });
  });

  describe('submitOrder — rejection (non-2xx)', () => {
    it('does not create mapping on rejection', async () => {
      (mockClient.submitOrder as jest.Mock).mockResolvedValueOnce({
        status: 422,
        data: { message: 'insufficient buying power' },
      });

      await service.submitOrder(TENANT_ID, ORDER_ID, SYMBOL, SIDE, QUANTITY);

      expect(mockOrderRepo.createMapping).not.toHaveBeenCalled();
    });

    it('returns AlpacaOrderResult with REJECTED status and rejectionReason', async () => {
      (mockClient.submitOrder as jest.Mock).mockResolvedValueOnce({
        status: 422,
        data: { message: 'insufficient buying power' },
      });

      const result = await service.submitOrder(TENANT_ID, ORDER_ID, SYMBOL, SIDE, QUANTITY);

      expect(result).toMatchObject({
        pk: `OrderMapping#${TENANT_ID}#${ORDER_ID}`,
        sk: 'OrderMapping',
        __typename: 'AlpacaOrderResult',
        tenantId: TENANT_ID,
        nestfolioOrderId: ORDER_ID,
        alpacaOrderId: '',
        status: 'REJECTED',
        symbol: SYMBOL,
        side: SIDE,
        requestedQty: QUANTITY,
      });
      expect(result.rejectionReason).toContain('insufficient buying power');
    });

    it('returns REJECTED for 500 status', async () => {
      (mockClient.submitOrder as jest.Mock).mockResolvedValueOnce({
        status: 500,
        data: { message: 'internal error' },
      });

      const result = await service.submitOrder(TENANT_ID, ORDER_ID, SYMBOL, SIDE, QUANTITY);

      expect(result.status).toBe('REJECTED');
    });
  });
});
