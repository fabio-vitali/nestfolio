import {
  materializeToTable, record,
  type EventPayload, type EventContext,
} from '@nestfolio/event-processor';
import { TRIGGER_EVENT_TYPES } from '../domain/events';

/**
 * Trigger handler — fan-in stage.
 * Subscribes to 11 heterogeneous trigger events and materialises each to a
 * WorkflowTrigger DDB row keyed by the trigger event's id. The subsequent
 * DDB stream drives the Egress CDC publisher, which emits WORKFLOW_TRIGGER_CREATED.
 * That canonical event is routed to the Decision state machine via the
 * Orchestration.triggers wiring in service.stack.ts.
 */
const triggerHandler = (payload: EventPayload, ctx: EventContext) => {
  const tenantId = (payload.subject?.tenantId as string) ?? ctx.tenantId;
  // decisionId = triggerEventId: aligns with advisory-ctrl's decision-lifecycle.service.ts,
  // which also keys on context.triggerEvent.id. Same trigger → same decisionId in both
  // services, so agent trace envelopes' correlationId matches what getDecisionHistory
  // surfaces. Bonus: SF is idempotent under at-least-once EB delivery (duplicate
  // trigger → conditional write in record() de-dupes).
  return record('WorkflowTrigger', {
    tenantId,
    decisionId: ctx.eventId,
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
