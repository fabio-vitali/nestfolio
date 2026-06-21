import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { BrokerOrderRepository } from '../repositories/broker-order.repository';
import { BrokerCtrlRoutedEventTypes } from '../domain/events';
import { logger, requireEnv, getUUID, getTime } from '@nestfolio/event-processor';

const TABLE_NAME = requireEnv('TABLE_NAME');
const BUS_NAME = requireEnv('BUS_NAME');
const SERVICE_NAME = 'broker-ctrl';
const REGION = process.env.AWS_REGION ?? 'us-east-1';

const repo = new BrokerOrderRepository(TABLE_NAME);
const eb = new EventBridgeClient({});

export interface RouteOrderEvent {
  order: {
    tenantId: string;
    orderId: string;
    userId: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    // Dollar amount in cents (the order request denomination). The adapter converts
    // amount→shares at the fill price (see broker-sim-adpt simulation engine).
    amountCents: number;
  };
  executionMode: string;
  taskToken: string;
}

export async function handler(event: RouteOrderEvent) {
  const { order, executionMode, taskToken } = event;

  logger.info('Routing order', { orderId: order.orderId, executionMode });

  // Write BrokerOrder with taskToken
  await repo.createOrder({
    tenantId: order.tenantId,
    orderId: order.orderId,
    executionMode,
    routedTo: executionMode === 'live' ? 'alpaca' : 'sim',
    requestedAmountCents: order.amountCents,
    instrumentId: order.symbol,
    fillTaskToken: taskToken,
  });

  // Emit routed event
  const detailType = executionMode === 'live'
    ? BrokerCtrlRoutedEventTypes.ALPACA_ORDER_REQUESTED
    : BrokerCtrlRoutedEventTypes.SIM_ORDER_REQUESTED;

  const detail = {
    id: getUUID(),
    type: detailType,
    timestamp: getTime(),
    subject: {
      orderId: order.orderId,
      userId: order.userId,
      symbol: order.symbol,
      side: order.side,
      amountCents: order.amountCents,
    },
    context: { tenantId: order.tenantId, userId: order.userId, region: REGION },
  };
  await eb.send(new PutEventsCommand({
    Entries: [{
      EventBusName: BUS_NAME,
      Source: `${BUS_NAME}@${SERVICE_NAME}`,
      DetailType: detailType,
      Detail: JSON.stringify(detail),
    }],
  }));

  logger.info('Order routed', { orderId: order.orderId, detailType, routedTo: executionMode === 'live' ? 'alpaca' : 'sim' });
}
