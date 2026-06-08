import { z } from 'zod';
import { record, parseSubject, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

/**
 * Consumer-owned view-model schema — documented exception to the producer-contract rule.
 *
 * The activity feed is polymorphic: ~8 different event types (ORDER_FILLED,
 * DECISION_APPROVED, DEPOSIT_DETECTED, etc.) each owned by different producers.
 * No single producer owns all these fields; this schema models only the optional
 * display fields that the ACTIVITY_DESCRIPTIONS map actually reads. All fields are
 * optional so the parse never throws on an event type that carries none of them.
 */
const RecentActivitySchema = z.object({
  symbol: z.string().optional(),
  orderId: z.string().optional(),
  decisionId: z.string().optional(),
  reason: z.string().optional(),
  amountCents: z.number().optional(),
  currency: z.string().optional(),
});

const ACTIVITY_DESCRIPTIONS: Record<string, (payload: z.infer<typeof RecentActivitySchema>) => string> = {
  ORDER_FILLED: (p) => `Order filled: ${p.symbol ?? p.orderId ?? 'unknown'}`,
  ORDER_PARTIALLY_FILLED: (p) => `Order partially filled: ${p.symbol ?? p.orderId ?? 'unknown'}`,
  DECISION_APPROVED: (p) => `Decision approved: ${p.decisionId ?? 'unknown'}`,
  DECISION_BLOCKED: (p) => `Decision blocked: ${p.reason ?? p.decisionId ?? 'unknown'}`,
  DEPOSIT_DETECTED: (p) => `Deposit detected: ${((p.amountCents ?? 0)) / 100} ${p.currency ?? ''}`.trim(),
  WITHDRAWAL_SETTLED: (p) => `Withdrawal settled: ${((p.amountCents ?? 0)) / 100} ${p.currency ?? ''}`.trim(),
};

export const recentActivity = (
  uow: UnitOfWork<BusEvent<unknown>>,
): WriteIntent => {
  const { event } = uow;
  const { tenantId, userId, region } = event.context;
  const payload = parseSubject(uow, RecentActivitySchema);

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
