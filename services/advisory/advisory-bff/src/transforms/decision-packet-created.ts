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

// Defence-in-depth: skip DECISION_PACKET_CREATED events that carry neither
// explanation nor proposed trades. Post-Spec-2 the sole emitter is
// decision-workflow-ctrl's AssemblePacket (assemble-packet.ts:75-86), which
// always lands the row populated, so this skip should never fire in practice.
// Keeping it cheap protects against degraded paths (e.g. AgentCore returning
// empty narrative output) producing an empty read-model row.
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
