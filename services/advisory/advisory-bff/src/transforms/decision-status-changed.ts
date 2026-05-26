import { updateOrRetry, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

type DecisionStatusPayload = {
  tenantId: string;
  decisionId: string;
  taskToken?: string;
  [key: string]: unknown;
};

// Status transitions that have a meaningful display value. DECISION_PACKET_UPDATED
// is deliberately ABSENT: sfn-callback (in decision-workflow-ctrl) writes a
// `DecisionPacket` update AFTER compliance returns DECISION_APPROVED/BLOCKED.
// Both events fan out to advisory-bff. If we mapped DECISION_PACKET_UPDATED to a
// status, the later UPDATED event would overwrite the terminal BLOCKED/APPROVED
// with an intermediate state (Bug E surfaced via Playwright 2026-05-24). PENDING
// (set by decisionPacketCreated) goes directly to the terminal status.
const EVENT_TO_STATUS: Record<string, string> = {
  DECISION_APPROVED: 'APPROVED',
  DECISION_BLOCKED: 'BLOCKED',
  USER_CONFIRMATION_REQUESTED: 'AWAITING_CONFIRMATION',
};

export const decisionStatusChanged = (
  uow: UnitOfWork<BusEvent<DecisionStatusPayload>>,
): WriteIntent | undefined => {
  const newStatus = EVENT_TO_STATUS[uow.event.type];
  if (!newStatus) return undefined as unknown as WriteIntent;

  // 2026-05-26 L2 race fix: for L2 decisions DECISION_APPROVED and
  // USER_CONFIRMATION_REQUESTED both fire and land here as independent
  // EventBridge → Lambda invocations. No completion-order guarantee → if
  // DECISION_APPROVED's write lands last, the badge sticks on APPROVED and the
  // Confirm button never appears. USER_CONFIRMATION_REQUESTED is the sole owner
  // of the AWAITING_CONFIRMATION transition for L2; this branch makes
  // DECISION_APPROVED a no-op for L2 so only one writer drives the L2 status.
  // L1 keeps the APPROVED terminal write (SF never emits
  // USER_CONFIRMATION_REQUESTED for L1; see decision-state-machine.ts approvedL1End).
  if (
    uow.event.type === 'DECISION_APPROVED' &&
    (uow.event.subject as { authorityLevel?: string }).authorityLevel === 'L2'
  ) {
    return undefined as unknown as WriteIntent;
  }

  // USER_CONFIRMATION_REQUESTED carries the SF taskToken on subject — persist
  // it onto DecisionReadModel so the confirmDecision / rejectDecision pre-step
  // can read it and stamp it onto the UserConfirmation / UserRejection row.
  // Other status transitions don't carry a token; only set when present.
  const fields: Record<string, unknown> = { status: newStatus };
  if (uow.event.subject.taskToken) {
    fields.taskToken = uow.event.subject.taskToken;
  }

  return updateOrRetry('DecisionReadModel', fields, {
    condition: 'attribute_exists(pk)',
    overrides: {
      pk: `Decision#${uow.event.subject.tenantId}#${uow.event.subject.decisionId}`,
      sk: 'DecisionReadModel',
    },
  });
};
