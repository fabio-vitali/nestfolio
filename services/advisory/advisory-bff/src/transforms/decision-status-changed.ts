import { update, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

type DecisionStatusPayload = {
  tenantId: string;
  decisionId: string;
  taskToken?: string;
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

  // USER_CONFIRMATION_REQUESTED carries the SF taskToken on subject — persist
  // it onto DecisionReadModel so the confirmDecision / rejectDecision pre-step
  // can read it and stamp it onto the UserConfirmation / UserRejection row.
  // Other status transitions don't carry a token; only set when present.
  const fields: Record<string, unknown> = { status: newStatus };
  if (uow.event.subject.taskToken) {
    fields.taskToken = uow.event.subject.taskToken;
  }

  return update('DecisionReadModel', fields, {
    condition: 'attribute_exists(pk)',
    overrides: {
      pk: `Decision#${uow.event.subject.tenantId}#${uow.event.subject.decisionId}`,
      sk: 'DecisionReadModel',
    },
  });
};
