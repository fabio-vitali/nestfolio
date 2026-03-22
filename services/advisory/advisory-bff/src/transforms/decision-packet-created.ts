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

export const decisionPacketCreated = (
  uow: UnitOfWork<BusEvent<DecisionPacketCreatedPayload>>,
): WriteIntent => {
  const { subject: p } = uow.event;
  return record('DecisionSummary', {
    tenantId: p.tenantId,
    decisionId: p.decisionId,
    trigger: p.trigger,
    proposedTrades: p.proposedTrades,
    explanation: p.explanation,
    confirmationRequired: p.confirmationRequired,
    complianceChecks: [],
    agentInvocations: [],
    sourceEventId: uow.event.id,
  });
};
