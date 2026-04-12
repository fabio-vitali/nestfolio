import { record, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

const ACTIVITY_DESCRIPTIONS: Record<string, (payload: Record<string, unknown>) => string> = {
  ORDER_FILLED: (p) => `Order filled: ${p.symbol ?? p.orderId ?? 'unknown'}`,
  ORDER_PARTIALLY_FILLED: (p) => `Order partially filled: ${p.symbol ?? p.orderId ?? 'unknown'}`,
  DECISION_APPROVED: (p) => `Decision approved: ${p.decisionId ?? 'unknown'}`,
  DECISION_BLOCKED: (p) => `Decision blocked: ${p.reason ?? p.decisionId ?? 'unknown'}`,
  DEPOSIT_DETECTED: (p) => `Deposit detected: ${((p.amountCents as number) ?? 0) / 100} ${p.currency ?? ''}`.trim(),
  WITHDRAWAL_COMPLETED: (p) => `Withdrawal completed: ${((p.amountCents as number) ?? 0) / 100} ${p.currency ?? ''}`.trim(),
};

export const recentActivity = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): WriteIntent => {
  const { event } = uow;
  const { tenantId, userId, region } = event.context;
  const payload = event.subject as Record<string, unknown>;

  const descriptionFn = ACTIVITY_DESCRIPTIONS[event.type];
  const description = descriptionFn
    ? descriptionFn(payload)
    : `${event.type}: ${JSON.stringify(payload).slice(0, 100)}`;

  return record('Activity', {
    tenantId,
    userId,
    region,
    activityId: event.id,
    activityType: event.type,
    description,
    createdAt: event.timestamp,
    metadata: JSON.stringify(payload),
  });
};
