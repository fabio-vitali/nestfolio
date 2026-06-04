import { projectVersioned, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

type CycleStatusSubject = {
  decisionId: string;
  tenantId: string;
  status: 'GENERATING' | 'FAILED';
  __version: number;
  [k: string]: unknown;
};

// WS-2: project the SF-direct cycle-lifecycle events onto the versioned
// DecisionReadModel P1 row BEFORE any DecisionPacket exists.
//   DECISION_CYCLE_STARTED → GENERATING (v0)
//   DECISION_CYCLE_FAILED  → FAILED      (v1)
// The subject is minimal ({ decisionId, tenantId, status, __version }); there is
// no content yet (explanation/proposedTrades are intentionally omitted). createdAt
// comes from the envelope timestamp (uow.event.timestamp) — the subject carries
// none; projectVersioned auto-stamps updatedAt from ctx.timestamp. The version
// guard (#__version < :version) makes this order-agnostic + idempotent: a content
// DECISION_PACKET_CREATED (v1) overwrites GENERATING (v0); a late STARTED (v0)
// after a real decision (v1) is dropped. DecisionReadModel stays Projection<'P1'>
// (same typename + projectVersioned intent — only new status values).
export const decisionCycleStatus = (
  uow: UnitOfWork<BusEvent<CycleStatusSubject>>,
): WriteIntent => {
  const p = uow.event.subject;
  return projectVersioned('DecisionReadModel', {
    decisionId: p.decisionId,
    tenantId: p.tenantId,
    status: p.status,
    // getPendingDecisions selects DecisionPacket.trigger (String!, non-nullable);
    // the cycle events carry no trigger, so write '' to keep the row query-valid.
    // Cosmetic only — GENERATING/FAILED rows are filtered out of the visible list
    // (advisory-mfe routes them to the spinner/error state, never a list item).
    trigger: '',
    version: p.__version,
    createdAt: uow.event.timestamp,
    updatedAt: uow.event.timestamp,
  }, {
    version: p.__version,
    overrides: { pk: `Decision#${p.tenantId}#${p.decisionId}`, sk: 'DecisionReadModel' },
  });
};
