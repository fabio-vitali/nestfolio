import type { SQSEvent } from 'aws-lambda';
import { SFNClient, SendTaskSuccessCommand } from '@aws-sdk/client-sfn';
import { BrokerOrderRepository } from '../repositories/broker-order.repository';
import { CircuitBreakerRepository } from '../repositories/circuit-breaker.repository';
import { logger, requireEnv } from '@nestfolio/event-processor';

const TABLE_NAME = requireEnv('TABLE_NAME');
const repo = new BrokerOrderRepository(TABLE_NAME);
const circuitBreakerRepo = new CircuitBreakerRepository(TABLE_NAME);
const sfn = new SFNClient({});

type FailureClass = 'none' | 'deterministic' | 'transient' | 'ambiguous';

function classifyFailure(eventType: string, payload: Record<string, unknown>): FailureClass {
  if (['SIM_ORDER_FILLED', 'ALPACA_ORDER_FILLED'].includes(eventType)) return 'none';
  if (['SIM_ORDER_REJECTED', 'ALPACA_ORDER_REJECTED'].includes(eventType)) {
    const reason = (payload.rejectionReason as string) ?? '';
    if (/insufficient|buying power/i.test(reason)) return 'deterministic';
    if (/halted|delisted|invalid/i.test(reason)) return 'deterministic';
    if (/timeout|5\d{2}|rate.limit|unavailable/i.test(reason)) return 'transient';
    return 'deterministic'; // default: don't retry unknown rejections
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

export async function handler(event: SQSEvent) {
  for (const record of event.Records) {
    try {
      const body = JSON.parse(record.body);
      const eventType = body['detail-type'] ?? body.detailType;
      const detail = typeof body.detail === 'string' ? JSON.parse(body.detail) : body.detail;
      const tenantId = detail.tenantId;
      const orderId = detail.subject?.orderId ?? detail.orderId;

      logger.info('Processing callback', { eventType, tenantId, orderId });

      // Look up taskToken
      let taskToken: string | null;

      if (eventType === 'ALPACA_ACCOUNT_SNAPSHOT') {
        const breaker = await circuitBreakerRepo.getBreaker(tenantId, 'Global');
        taskToken = (breaker?.healTaskToken as string) ?? null;
      } else {
        taskToken = await repo.getTaskToken(tenantId, orderId);
      }

      if (!taskToken) {
        logger.warn('No active taskToken found, skipping', { orderId, eventType });
        continue;
      }

      const failureClass = classifyFailure(eventType, detail.subject ?? detail);

      await sfn.send(new SendTaskSuccessCommand({
        taskToken,
        output: JSON.stringify({
          status: mapEventToStatus(eventType),
          filledQty: detail.subject?.filledQuantity ?? detail.filledQuantity,
          averageFillPrice: detail.subject?.averageFillPrice ?? detail.averageFillPrice,
          failureClass,
          failureReason: detail.subject?.rejectionReason ?? detail.rejectionReason,
        }),
      }));

      logger.info('Task callback sent', { eventType, orderId, status: mapEventToStatus(eventType) });
    } catch (error) {
      logger.error('Failed to process callback', { error, messageId: record.messageId });
      throw error;
    }
  }
}
