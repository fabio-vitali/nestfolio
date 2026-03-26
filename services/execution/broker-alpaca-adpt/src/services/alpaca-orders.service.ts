import { logger } from '@nestfolio/event-processor';
import { AlpacaClient } from '../clients/alpaca.client';
import { OrderMappingRepository } from '../repositories/order-mapping.repository';
import { PollingStateRepository } from '../repositories/polling-state.repository';

export class AlpacaOrdersService {
  constructor(
    private readonly client: AlpacaClient,
    private readonly orderRepo: OrderMappingRepository,
    private readonly pollingRepo: PollingStateRepository,
  ) {}

  async submitOrder(tenantId: string, orderId: string, symbol: string, side: string, quantity: number) {
    const result = await this.client.submitOrder({
      symbol,
      qty: quantity,
      side: side.toLowerCase() as 'buy' | 'sell',
      type: 'market',
      time_in_force: 'day',
    });

    if (result.status >= 200 && result.status < 300) {
      const alpacaOrderId = result.data.id;
      await this.orderRepo.createMapping(tenantId, orderId, alpacaOrderId, symbol, side, quantity);
      await this.pollingRepo.incrementOpenOrderCount(tenantId);
      logger.info('Order placed', { orderId, alpacaOrderId });

      return {
        pk: `OrderMapping#${tenantId}#${orderId}`,
        sk: 'OrderMapping',
        __typename: 'AlpacaOrderResult' as const,
        tenantId,
        nestfolioOrderId: orderId,
        alpacaOrderId,
        status: 'PLACED',
        symbol,
        side,
        requestedQty: quantity,
      };
    } else {
      logger.warn('Order rejected by Alpaca', { orderId, status: result.status, data: result.data });

      return {
        pk: `OrderMapping#${tenantId}#${orderId}`,
        sk: 'OrderMapping',
        __typename: 'AlpacaOrderResult' as const,
        tenantId,
        nestfolioOrderId: orderId,
        alpacaOrderId: '',
        status: 'REJECTED',
        rejectionReason: JSON.stringify(result.data),
        symbol,
        side,
        requestedQty: quantity,
      };
    }
  }
}
