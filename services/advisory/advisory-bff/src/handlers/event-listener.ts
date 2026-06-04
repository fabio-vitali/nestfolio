import '../read-model-ownership';
import { materializeToTable, toUow, skip, type WriteIntent } from '@nestfolio/event-processor';
import { DecisionWorkflowEventTypes } from '@nestfolio/decision-workflow-ctrl/events';
import { decisionSnapshot } from '../transforms/decision-snapshot';
import { decisionCycleStatus } from '../transforms/decision-cycle-status';

// decisionSnapshot returns undefined for degraded snapshots (no explanation + no
// trades). materializeToTable's HandlerFn must return a WriteIntent, so coerce the
// drop to a skip() intent (terminal no-op) rather than undefined.
const project = (payload: unknown, ctx: unknown): WriteIntent =>
  decisionSnapshot(toUow(payload as never, ctx as never) as never) ?? skip();

// WS-2: cycle-lifecycle events project a minimal versioned GENERATING/FAILED row.
// decisionCycleStatus never degrades (it always emits a projectVersioned intent),
// so no skip() coercion is needed here.
const cycleStatus = (payload: unknown, ctx: unknown): WriteIntent =>
  decisionCycleStatus(toUow(payload as never, ctx as never) as never);

export function createHandlers() {
  return {
    [DecisionWorkflowEventTypes.DECISION_PACKET_CREATED]: project,
    [DecisionWorkflowEventTypes.DECISION_PACKET_UPDATED]: project,
    [DecisionWorkflowEventTypes.DECISION_CYCLE_STARTED]: cycleStatus,
    [DecisionWorkflowEventTypes.DECISION_CYCLE_FAILED]: cycleStatus,
  };
}

export const handler = materializeToTable({
  serviceName: 'advisory-bff',
  handlers: createHandlers(),
  errorEventType: 'ADVISORY_BFF_FAILED',
});
