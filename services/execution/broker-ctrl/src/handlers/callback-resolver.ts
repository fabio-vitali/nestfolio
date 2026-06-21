import { createIngestionHandler, skip, logger, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { SFNClient, SendTaskSuccessCommand } from '@aws-sdk/client-sfn';
import { BrokerOrderRepository } from '../repositories/broker-order.repository';
import { BrokerCtrlInboundEventTypes } from '../domain/events';

const TABLE_NAME = process.env['TABLE_NAME']!;
const repo = new BrokerOrderRepository(TABLE_NAME);
const sfn = new SFNClient({});

type FailureClass = 'none' | 'deterministic' | 'transient' | 'ambiguous';

// boundary: subject is an internal adapter result shape (see resolveCallback boundary comment above).
function classifyFailure(eventType: string, subject: Record<string, unknown>): FailureClass {
  if ([BrokerCtrlInboundEventTypes.SIM_ORDER_FILLED, BrokerCtrlInboundEventTypes.ALPACA_ORDER_FILLED].includes(eventType)) return 'none';
  if ([BrokerCtrlInboundEventTypes.SIM_ORDER_REJECTED, BrokerCtrlInboundEventTypes.ALPACA_ORDER_REJECTED].includes(eventType)) {
    const reason = (subject.rejectionReason as string) ?? '';
    if (/insufficient|buying power/i.test(reason)) return 'deterministic';
    if (/halted|delisted|invalid/i.test(reason)) return 'deterministic';
    if (/timeout|5\d{2}|rate.limit|unavailable/i.test(reason)) return 'transient';
    return 'deterministic';
  }
  if ([BrokerCtrlInboundEventTypes.SIM_DEPOSIT_COMPLETED, BrokerCtrlInboundEventTypes.SIM_WITHDRAWAL_COMPLETED, BrokerCtrlInboundEventTypes.ALPACA_TRANSFER_COMPLETED].includes(eventType)) return 'none';
  if ([BrokerCtrlInboundEventTypes.ALPACA_TRANSFER_FAILED].includes(eventType)) return 'deterministic';
  if ([BrokerCtrlInboundEventTypes.ALPACA_ORDER_PARTIALLY_FILLED].includes(eventType)) return 'none';
  if ([BrokerCtrlInboundEventTypes.ALPACA_ORDER_CANCELLED, BrokerCtrlInboundEventTypes.ALPACA_ORDER_CANCEL_FAILED].includes(eventType)) return 'none';
  return 'ambiguous';
}

function mapEventToStatus(eventType: string): string {
  const statusMap: Record<string, string> = {
    [BrokerCtrlInboundEventTypes.SIM_ORDER_FILLED]: 'FILLED',
    [BrokerCtrlInboundEventTypes.ALPACA_ORDER_FILLED]: 'FILLED',
    [BrokerCtrlInboundEventTypes.ALPACA_ORDER_PARTIALLY_FILLED]: 'PARTIALLY_FILLED',
    [BrokerCtrlInboundEventTypes.SIM_ORDER_REJECTED]: 'REJECTED',
    [BrokerCtrlInboundEventTypes.ALPACA_ORDER_REJECTED]: 'REJECTED',
    [BrokerCtrlInboundEventTypes.ALPACA_ORDER_CANCELLED]: 'CANCELLED',
    [BrokerCtrlInboundEventTypes.ALPACA_ORDER_CANCEL_FAILED]: 'CANCEL_FAILED',
  };
  return statusMap[eventType] ?? eventType;
}

async function resolveCallback(payload: EventPayload, ctx: EventContext) {
  // boundary: SIM_ORDER_* / ALPACA_ORDER_* are internal adapter results (broker-ctrl routing +
  // Alpaca webhook CDC) with no exported nestfolio producer contract. Per locked boundary policy
  // (WS-3): no contract authored, reads kept as-is.
  const orderId = (payload.subject.orderId as string) ?? ctx.eventId;

  const taskToken = await repo.getTaskToken(ctx.tenantId, orderId);

  if (!taskToken) {
    logger.warn('No active taskToken found, skipping', { orderId, eventType: ctx.eventType });
    return skip();
  }

  const failureClass = classifyFailure(ctx.eventType, payload.subject);

  // The sim adapter emits a VirtualTrade subject (`quantity`/`fillPrice`); the alpaca adapter
  // uses `filledQuantity`/`averageFillPrice`. Normalize both to the SF's {filledQty, averageFillPrice}.
  const isSim = ctx.eventType.startsWith('SIM_');
  const filledQty = isSim ? payload.subject.quantity : payload.subject.filledQuantity;
  const averageFillPrice = isSim ? payload.subject.fillPrice : payload.subject.averageFillPrice;
  const failureReason = (payload.subject.rejectionReason ?? payload.subject.rejectReason) as string | undefined;

  await sfn.send(new SendTaskSuccessCommand({
    taskToken,
    output: JSON.stringify({
      status: mapEventToStatus(ctx.eventType),
      filledQty,
      averageFillPrice,
      failureClass,
      failureReason,
    }),
  }));

  logger.info('Task callback sent', {
    eventType: ctx.eventType, orderId, status: mapEventToStatus(ctx.eventType),
  });

  return skip();
}

const CALLBACK_EVENT_TYPES = [
  BrokerCtrlInboundEventTypes.SIM_ORDER_FILLED,
  BrokerCtrlInboundEventTypes.SIM_ORDER_REJECTED,
  BrokerCtrlInboundEventTypes.ALPACA_ORDER_FILLED,
  BrokerCtrlInboundEventTypes.ALPACA_ORDER_PARTIALLY_FILLED,
  BrokerCtrlInboundEventTypes.ALPACA_ORDER_REJECTED,
  BrokerCtrlInboundEventTypes.ALPACA_ORDER_CANCELLED,
  BrokerCtrlInboundEventTypes.ALPACA_ORDER_CANCEL_FAILED,
] as const;

export const handler = createIngestionHandler({
  serviceName: 'broker-ctrl',
  handlers: Object.fromEntries(
    CALLBACK_EVENT_TYPES.map(et => [et, resolveCallback]),
  ),
});
