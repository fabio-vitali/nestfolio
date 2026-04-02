import { update, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

type DecisionStatusPayload = {
  tenantId: string;
  decisionId: string;
  [key: string]: unknown;
};

const EVENT_TO_STATUS: Record<string, string> = {
  DECISION_PACKET_UPDATED: 'COMPLIANCE_REVIEW',
  DECISION_APPROVED: 'APPROVED',
  DECISION_BLOCKED: 'BLOCKED',
  USER_CONFIRMATION_REQUESTED: 'AWAITING_CONFIRMATION',
};

export const decisionStatusChanged = (
  uow: UnitOfWork<BusEvent<DecisionStatusPayload>>,
): WriteIntent | undefined => {
  const newStatus = EVENT_TO_STATUS[uow.event.type];
  if (!newStatus) return undefined as unknown as WriteIntent;

  return update('DecisionSummary', {
    status: newStatus,
  }, {
    overrides: {
      pk: `T#${uow.event.subject.tenantId}`,
      sk: `DecisionSummary#${uow.event.subject.decisionId}`,
    },
  });
};
