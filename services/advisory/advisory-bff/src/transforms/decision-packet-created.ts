import { record, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

type DecisionPacketCreatedPayload = {
  tenantId: string;
  decisionId: string;
  trigger: string;
  proposedTrades: unknown[];
  explanation: string;
  confirmationRequired: boolean;
};

// Two services emit DECISION_PACKET_CREATED for the same decision: advisory-ctrl
// writes an empty packet first (its sync agent pipeline regularly hits the 30s
// Lambda timeout before the follow-up update with explanation can fire), and
// decision-workflow-ctrl's AssemblePacket lands a packet with the synthesized
// explanation seconds later. `record()` is putIfNotExists, so whichever event
// arrives first wins — and the empty advisory-ctrl event arrives first because
// its DDB write is synchronous on the trigger. Skip events that carry no
// explanation so the populated event from the other source creates the row.
export const decisionPacketCreated = (
  uow: UnitOfWork<BusEvent<DecisionPacketCreatedPayload>>,
): WriteIntent | undefined => {
  const { subject: p } = uow.event;
  const hasExplanation = typeof p.explanation === 'string' && p.explanation.length > 0;
  const hasTrades = Array.isArray(p.proposedTrades) && p.proposedTrades.length > 0;
  if (!hasExplanation && !hasTrades) return undefined;

  return record('DecisionReadModel', {
    tenantId: p.tenantId,
    decisionId: p.decisionId,
    trigger: p.trigger,
    proposedTrades: p.proposedTrades,
    explanation: p.explanation,
    confirmationRequired: p.confirmationRequired,
    complianceChecks: [],
    agentInvocations: [],
    status: 'PENDING',
    version: 1,
    sourceEventId: uow.event.id,
    createdAt: uow.event.timestamp,
    updatedAt: uow.event.timestamp,
  }, {
    pk: `Decision#${p.tenantId}#${p.decisionId}`,
    sk: 'DecisionReadModel',
  });
};
