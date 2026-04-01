import { logger, requireEnv } from '@nestfolio/event-processor';
import { AlpacaClient } from '../clients/alpaca.client';
import { OrderMappingRepository } from '../repositories/order-mapping.repository';

const TABLE_NAME = requireEnv('TABLE_NAME');
const orderRepo = new OrderMappingRepository(TABLE_NAME);
const client = new AlpacaClient();

interface PollInput {
  action: 'poll' | 'write' | 'timeout';
  tenantId: string;
  nestfolioOrderId: string;
  alpacaOrderId: string;
  backoffSeconds: number;
  // Present when action = 'write'
  status?: string;
  filledQuantity?: number;
  averageFillPrice?: number;
  rejectionReason?: string;
}

const ALPACA_STATUS_MAP: Record<string, string> = {
  filled: 'FILLED',
  partially_filled: 'PARTIALLY_FILLED',
  canceled: 'CANCELLED',
  expired: 'CANCELLED',
  rejected: 'REJECTED',
  suspended: 'REJECTED',
};

export async function handler(event: PollInput) {
  const { action, tenantId, nestfolioOrderId, alpacaOrderId, backoffSeconds } = event;

  if (action === 'poll') {
    return pollOrder(tenantId, nestfolioOrderId, alpacaOrderId, backoffSeconds);
  }
  if (action === 'write') {
    return writeResult(event);
  }
  if (action === 'timeout') {
    return handleTimeout(tenantId, nestfolioOrderId, alpacaOrderId);
  }
  throw new Error(`Unknown action: ${action}`);
}

async function pollOrder(tenantId: string, nestfolioOrderId: string, alpacaOrderId: string, backoffSeconds: number) {
  const result = await client.getOrder(alpacaOrderId);

  if (result.status === 404) {
    logger.info('Order not found at Alpaca, marking REJECTED', { alpacaOrderId });
    return { status: 'REJECTED', tenantId, nestfolioOrderId, alpacaOrderId, rejectionReason: 'Order not found at Alpaca', backoffSeconds };
  }
  if (result.status === 429 || result.status >= 500) {
    throw new Error(`Alpaca API error: ${result.status}`);
  }

  const alpacaStatus = result.data.status;
  const mappedStatus = ALPACA_STATUS_MAP[alpacaStatus] ?? 'OPEN';

  logger.info('Polled order status', { alpacaOrderId, alpacaStatus, mappedStatus });

  return {
    status: mappedStatus,
    tenantId,
    nestfolioOrderId,
    alpacaOrderId,
    filledQuantity: Number(result.data.filled_qty) || undefined,
    averageFillPrice: Number(result.data.filled_avg_price) || undefined,
    backoffSeconds,
  };
}

async function writeResult(event: PollInput) {
  const { tenantId, nestfolioOrderId, status } = event;
  const updates: Record<string, unknown> = {};
  if (event.filledQuantity) updates.filledQuantity = event.filledQuantity;
  if (event.averageFillPrice) updates.averageFillPrice = event.averageFillPrice;
  if (event.rejectionReason) updates.rejectionReason = event.rejectionReason;

  await orderRepo.updateStatus(tenantId, nestfolioOrderId, status!, updates);
  logger.info('Wrote order result', { tenantId, nestfolioOrderId, status });
}

async function handleTimeout(tenantId: string, nestfolioOrderId: string, alpacaOrderId: string) {
  logger.info('Order polling timeout, attempting cancel', { tenantId, nestfolioOrderId, alpacaOrderId });

  const cancelResult = await client.cancelOrder(alpacaOrderId);

  if (cancelResult.status < 300) {
    // Cancel succeeded — write CANCELLED
    await orderRepo.updateStatus(tenantId, nestfolioOrderId, 'CANCELLED', { rejectionReason: 'Polling timeout — order cancelled' });
    logger.info('Order cancelled on timeout', { tenantId, nestfolioOrderId });
    return;
  }

  // Cancel failed — order may have filled, get actual status
  logger.info('Cancel failed, fetching actual status', { tenantId, nestfolioOrderId, cancelStatus: cancelResult.status });
  const orderResult = await client.getOrder(alpacaOrderId);
  const alpacaStatus = orderResult.data.status;
  const mappedStatus = ALPACA_STATUS_MAP[alpacaStatus] ?? 'REJECTED';

  const updates: Record<string, unknown> = {
    rejectionReason: `Polling timeout — actual Alpaca status: ${alpacaStatus}`,
  };
  if (Number(orderResult.data.filled_qty)) updates.filledQuantity = Number(orderResult.data.filled_qty);
  if (Number(orderResult.data.filled_avg_price)) updates.averageFillPrice = Number(orderResult.data.filled_avg_price);

  await orderRepo.updateStatus(tenantId, nestfolioOrderId, mappedStatus, updates);
  logger.info('Wrote actual status on timeout', { tenantId, nestfolioOrderId, mappedStatus });
}
