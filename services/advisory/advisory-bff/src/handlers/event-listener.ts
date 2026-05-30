import '../read-model-ownership';
import { materializeToTable, toUow, skip, type WriteIntent } from '@nestfolio/event-processor';
import { DecisionWorkflowEventTypes } from '@nestfolio/decision-workflow-ctrl/events';
import { decisionSnapshot } from '../transforms/decision-snapshot';

// decisionSnapshot returns undefined for degraded snapshots (no explanation + no
// trades). materializeToTable's HandlerFn must return a WriteIntent, so coerce the
// drop to a skip() intent (terminal no-op) rather than undefined.
const project = (payload: unknown, ctx: unknown): WriteIntent =>
  decisionSnapshot(toUow(payload as never, ctx as never) as never) ?? skip();

export function createHandlers() {
  return {
    [DecisionWorkflowEventTypes.DECISION_PACKET_CREATED]: project,
    [DecisionWorkflowEventTypes.DECISION_PACKET_UPDATED]: project,
  };
}

export const handler = materializeToTable({
  serviceName: 'advisory-bff',
  handlers: createHandlers(),
  errorEventType: 'ADVISORY_BFF_FAILED',
});
