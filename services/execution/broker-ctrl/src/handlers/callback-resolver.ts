import { createIngestionHandler, skip, logger, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { SFNClient, SendTaskSuccessCommand } from '@aws-sdk/client-sfn';
import { BrokerOrderRepository } from '../repositories/broker-order.repository';
import { CircuitBreakerRepository } from '../repositories/circuit-breaker.repository';
import { BrokerCtrlInboundEventTypes } from '../domain/events';

const TABLE_NAME = process.env['TABLE_NAME']!;
const repo = new BrokerOrderRepository(TABLE_NAME);
const circuitBreakerRepo = new CircuitBreakerRepository(TABLE_NAME);
const sfn = new SFNClient({});

type FailureClass = 'none' | 'deterministic' | 'transient' | 'ambiguous';

function classifyFailure(eventType: string, subject: Record<string, unknown>): FailureClass {
  if (['SIM_ORDER_FILLED', 'ALPACA_ORDER_FILLED'].includes(eventType)) return 'none';
  if (['SIM_ORDER_REJECTED', 'ALPACA_ORDER_REJECTED'].includes(eventType)) {
    const reason = (subject.rejectionReason as string) ?? '';
    if (/insufficient|buying power/i.test(reason)) return 'deterministic';
    if (/halted|delisted|invalid/i.test(reason)) return 'deterministic';
    if (/timeout|5\d{2}|rate.limit|unavailable/i.test(reason)) return 'transient';
    return 'deterministic';
  }
  if (['SIM_DEPOSIT_COMPLETED', 'SIM_WITHDRAWAL_COMPLETED', 'ALPACA_TRANSFER_COMPLETED'].includes(eventType)) return 'none';
  if (['ALPACA_TRANSFER_FAILED'].includes(eventType)) return 'deterministic';
  if (['ALPACA_ORDER_PARTIALLY_FILLED'].includes(eventType)) return 'none';
  if (['ALPACA_ORDER_CANCELLED', 'ALPACA_ORDER_CANCEL_FAILED'].includes(eventType)) return 'none';
  if (['ALPACA_ACCOUNT_SNAPSHOT'].includes(eventType)) return 'none';
  return 'ambiguous';
}

function mapEventToStatus(eventType: string): string {
  const statusMap: Record<string, string> = {
    SIM_ORDER_FILLED: 'FILLED',
    ALPACA_ORDER_FILLED: 'FILLED',
    ALPACA_ORDER_PARTIALLY_FILLED: 'PARTIALLY_FILLED',
    SIM_ORDER_REJECTED: 'REJECTED',
    ALPACA_ORDER_REJECTED: 'REJECTED',
    ALPACA_ORDER_CANCELLED: 'CANCELLED',
    ALPACA_ORDER_CANCEL_FAILED: 'CANCEL_FAILED',
    ALPACA_ACCOUNT_SNAPSHOT: 'SNAPSHOT_RECEIVED',
  };
  return statusMap[eventType] ?? eventType;
}

async function resolveCallback(payload: EventPayload, ctx: EventContext) {
  const orderId = (payload.subject.orderId as string) ?? ctx.eventId;

  let taskToken: string | null;
  if (ctx.eventType === 'ALPACA_ACCOUNT_SNAPSHOT') {
    const breaker = await circuitBreakerRepo.getBreaker(ctx.tenantId, 'Global');
    taskToken = (breaker?.healTaskToken as string) ?? null;
  } else {
    taskToken = await repo.getTaskToken(ctx.tenantId, orderId);
  }

  if (!taskToken) {
    logger.warn('No active taskToken found, skipping', { orderId, eventType: ctx.eventType });
    return skip();
  }

  const failureClass = classifyFailure(ctx.eventType, payload.subject);

  await sfn.send(new SendTaskSuccessCommand({
    taskToken,
    output: JSON.stringify({
      status: mapEventToStatus(ctx.eventType),
      filledQty: payload.subject.filledQuantity,
      averageFillPrice: payload.subject.averageFillPrice,
      failureClass,
      failureReason: payload.subject.rejectionReason,
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
  BrokerCtrlInboundEventTypes.ALPACA_ACCOUNT_SNAPSHOT,
] as const;

export const handler = createIngestionHandler({
  serviceName: 'broker-ctrl',
  handlers: Object.fromEntries(
    CALLBACK_EVENT_TYPES.map(et => [et, resolveCallback]),
  ),
});
