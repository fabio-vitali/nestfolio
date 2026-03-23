import {
  materializeToTable, record, getUUID,
  type EventPayload, type EventContext,
} from '@nestfolio/event-processor';
import { TRIGGER_EVENT_TYPES } from '../domain/events';

/**
 * Trigger handler — writes a WorkflowTrigger record to DDB.
 * CDK EventBridge rule starts Step Functions when CDC publishes WORKFLOW_TRIGGER_CREATED.
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
