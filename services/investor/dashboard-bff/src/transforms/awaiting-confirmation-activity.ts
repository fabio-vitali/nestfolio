import { z } from 'zod';
import { record, parseSubject, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

// Status-filtered projection of the DecisionPacket row CDC
// (DECISION_PACKET_UPDATED, forwarded advisory→investor by investor-adpt) into
// the activity feed: exactly one "awaiting confirmation" Activity row per
// decision. The signal is sourced from the DecisionPacket AWAITING_CONFIRMATION
// status via the existing row CDC (backlog:
// dashboard-bff-awaiting-confirmation-activity-gap) — never from the removed
// dead USER_CONFIRMATION_REQUESTED event.
//
// Like RecentActivitySchema, this consumer-owned schema reads only the fields
// the projection needs and never throws: identity (tenantId/userId/region) is
// DRY and travels in the event CONTEXT, not the subject.
const AwaitingConfirmationSchema = z.object({
  decisionId: z.string().optional(),
  status: z.string().optional(),
});

export const awaitingConfirmationActivity = (
  uow: UnitOfWork<BusEvent<unknown>>,
): WriteIntent | undefined => {
  const { event } = uow;
  const { tenantId, userId, region } = event.context;
  const p = parseSubject(uow, AwaitingConfirmationSchema);
  if (p.status !== 'AWAITING_CONFIRMATION' || !p.decisionId) return undefined;

  // Keyed by decisionId, not event id: record()'s attribute_not_exists guard
  // then collapses CDC redeliveries and repeated AWAITING_CONFIRMATION updates
  // to one awaiting-confirmation row per decision.
  return record('Activity', {
    tenantId,
    userId,
    region,
    activityId: `awaiting-confirmation#${p.decisionId}`,
    activityType: event.type,
    description: `Decision awaiting your confirmation: ${p.decisionId}`,
    createdAt: event.timestamp,
    metadata: JSON.stringify({ decisionId: p.decisionId, status: p.status }),
  }, { sk: `Activity#awaiting-confirmation#${p.decisionId}` });
};
