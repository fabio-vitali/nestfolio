import { logger, requireEnv, getTime } from '@nestfolio/event-processor';
import { AlpacaClient } from '../clients/alpaca.client';
import { OrderMappingRepository } from '../repositories/order-mapping.repository';
import { PollingStateRepository } from '../repositories/polling-state.repository';

const TABLE_NAME = requireEnv('TABLE_NAME');
const orderRepo = new OrderMappingRepository(TABLE_NAME);
const pollingRepo = new PollingStateRepository(TABLE_NAME);
const client = new AlpacaClient();

export async function handler() {
  // This is a scheduled Lambda, so we need to iterate over all tenants with open orders
  // For MVP, we'll process a single tenant from the event input
  // In production, this would iterate over a list of tenants with openOrderCount > 0

  // For now, the poller processes events from the scheduled event input
  logger.info('Trade event poller invoked');

  // TODO: In a production implementation, this would:
  // 1. Query all tenants with openOrderCount > 0
  // 2. For each tenant, poll Alpaca trade events
  // 3. Match events to order mappings and write fill/rejection records
  // The architecture is designed to support this via PollingState records

  // For now, implement the core logic for a single tenant
}

// Exported for testing
export async function processTradeEventsForTenant(tenantId: string) {
  const pollingState = await pollingRepo.getState(tenantId);
  if (!pollingState || (pollingState.openOrderCount as number) === 0) {
    logger.info('No open orders, skipping', { tenantId });
    return;
  }

  const now = getTime();
  const since = (pollingState.lastCheckedAt as string) ?? new Date(Date.now() - 60000).toISOString();

  const result = await client.getTradeEvents(since, now);
  const events = (result.data as any[]) ?? [];

  for (const event of events) {
    const alpacaOrderId = event.order?.id;
    if (!alpacaOrderId) continue;

    const mapping = await orderRepo.getByAlpacaOrderId(tenantId, alpacaOrderId);
    if (!mapping) continue;

    const nestfolioOrderId = mapping.nestfolioOrderId as string;
    const eventType = event.event as string;

    if (eventType === 'fill' || eventType === 'partial_fill') {
      const status = eventType === 'fill' ? 'FILLED' : 'PARTIALLY_FILLED';
      await orderRepo.updateStatus(tenantId, nestfolioOrderId, status, {
        filledQuantity: Number(event.qty),
        averageFillPrice: Number(event.price),
      });

      if (eventType === 'fill') {
        await pollingRepo.decrementOpenOrderCount(tenantId);
      }

      logger.info('Trade event processed', { tenantId, nestfolioOrderId, status });
    } else if (eventType === 'rejected' || eventType === 'canceled') {
      const status = eventType === 'rejected' ? 'REJECTED' : 'CANCELLED';
      await orderRepo.updateStatus(tenantId, nestfolioOrderId, status, {
        rejectionReason: event.reason,
      });
      await pollingRepo.decrementOpenOrderCount(tenantId);
      logger.info('Trade event processed', { tenantId, nestfolioOrderId, status });
    }
  }

  await pollingRepo.updateLastCheckedAt(tenantId, now);
}
