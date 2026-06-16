import { projectVersioned, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

// DRY subject: identity (tenantId/userId/region) is EXCLUDED from the DecisionPacket
// CDC subject (decision-workflow-ctrl/domain/contracts.ts) and travels in the event
// CONTEXT. Do NOT add tenantId here — reading it off the subject yields undefined and
// keys the row at Decision#undefined#… (the 2026-06-16 happy-path-decision wedge).
type DecisionSnapshot = {
  decisionId: string; trigger: string; status: string;
  proposedTrades: unknown[]; explanation: string; confirmationRequired: boolean;
  confirmedAt?: string; rejectedAt?: string; rejectionReason?: string;
  taskToken?: string; __version: number; createdAt: string; updatedAt: string;
  [k: string]: unknown;
};

// Single transform for DECISION_PACKET_CREATED + DECISION_PACKET_UPDATED. The CDC
// subject is the DRY DecisionPacket contract (NewImage minus identity); project it
// into the versioned DecisionReadModel P1 row, keyed by the tenantId carried in the
// event context. The version guard (projectVersioned) makes out-of-order delivery +
// the old sparse-item / APPROVED→AWAITING races impossible.
export const decisionSnapshot = (
  uow: UnitOfWork<BusEvent<DecisionSnapshot>>,
): WriteIntent | undefined => {
  const p = uow.event.subject;
  // Identity is DRY — it lives in context, NOT the subject (see type comment above).
  const { tenantId } = uow.event.context;
  // Defence-in-depth: never materialize an empty row from a degraded producer path.
  const hasExplanation = typeof p.explanation === 'string' && p.explanation.length > 0;
  const hasTrades = Array.isArray(p.proposedTrades) && p.proposedTrades.length > 0;
  if (!hasExplanation && !hasTrades) return undefined;

  return projectVersioned('DecisionReadModel', {
    decisionId: p.decisionId,
    tenantId,
    trigger: p.trigger,
    status: p.status,
    proposedTrades: p.proposedTrades,
    explanation: p.explanation,
    confirmationRequired: p.confirmationRequired,
    confirmedAt: p.confirmedAt,
    rejectedAt: p.rejectedAt,
    rejectionReason: p.rejectionReason,
    complianceChecks: [],
    agentInvocations: [],
    version: p.__version,
    taskToken: p.taskToken,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }, {
    version: p.__version,
    overrides: { pk: `Decision#${tenantId}#${p.decisionId}`, sk: 'DecisionReadModel' },
  });
};
