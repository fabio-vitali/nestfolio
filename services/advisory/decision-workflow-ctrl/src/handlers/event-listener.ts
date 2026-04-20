import {
  materializeToTable, record, getUUID,
  type EventPayload, type EventContext,
} from '@nestfolio/event-processor';
import { TRIGGER_EVENT_TYPES } from '../domain/events';

/**
 * Trigger handler — fan-in stage.
 * Subscribes to 11 heterogeneous trigger events and materialises each to a
 * WorkflowTrigger DDB row with a freshly-allocated decisionId. The subsequent
 * DDB stream drives the Egress CDC publisher, which emits WORKFLOW_TRIGGER_CREATED.
 * That canonical event is routed to the Decision state machine via the
 * Orchestration.triggers wiring in service.stack.ts.
 */
const triggerHandler = (payload: EventPayload, ctx: EventContext) => {
  const tenantId = (payload.subject?.tenantId as string) ?? ctx.tenantId;
  return record('WorkflowTrigger', {
    tenantId,
    decisionId: getUUID(),
    trigger: ctx.eventType,
    triggerEventId: ctx.eventId,
    context: payload.subject ?? {},
  });
};

export const handler = materializeToTable({
  serviceName: 'decision-workflow-ctrl',
  handlers: Object.fromEntries(
    TRIGGER_EVENT_TYPES.map(type => [type, triggerHandler]),
  ),
  errorEventType: 'DECISION_WORKFLOW_FAILED',
});
