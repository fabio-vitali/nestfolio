import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { BrokerOrderRepository } from '../repositories/broker-order.repository';
import { BrokerCtrlRoutedEventTypes } from '../domain/events';
import { logger, requireEnv } from '@nestfolio/event-processor';

const TABLE_NAME = requireEnv('TABLE_NAME');
const BUS_NAME = requireEnv('BUS_NAME');

const repo = new BrokerOrderRepository(TABLE_NAME);
const eb = new EventBridgeClient({});

export interface RouteOrderEvent {
  order: {
    tenantId: string;
    orderId: string;
    userId: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
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
    requestedQty: order.quantity,
    instrumentId: order.symbol,
    fillTaskToken: taskToken,
  });

  // Emit routed event
  const detailType = executionMode === 'live'
    ? BrokerCtrlRoutedEventTypes.ALPACA_ORDER_REQUESTED
    : BrokerCtrlRoutedEventTypes.SIM_ORDER_REQUESTED;

  await eb.send(new PutEventsCommand({
    Entries: [{
      EventBusName: BUS_NAME,
      Source: 'broker-ctrl',
      DetailType: detailType,
      Detail: JSON.stringify({
        tenantId: order.tenantId,
        subject: {
          orderId: order.orderId,
          userId: order.userId,
          symbol: order.symbol,
          side: order.side,
          quantity: order.quantity,
        },
      }),
    }],
  }));

  logger.info('Order routed', { orderId: order.orderId, detailType, routedTo: executionMode === 'live' ? 'alpaca' : 'sim' });
}
