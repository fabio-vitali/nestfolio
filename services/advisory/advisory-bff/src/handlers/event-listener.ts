import { materializeToTable, toUow } from '@nestfolio/event-processor';
import { DecisionWorkflowEventTypes, TRIGGER_EVENT_TYPES } from '@nestfolio/decision-workflow-ctrl/events';
import { ComplianceEventTypes } from '@nestfolio/compliance-ctrl/events';
import { decisionPacketCreated } from '../transforms/decision-packet-created';
import { decisionStatusChanged } from '../transforms/decision-status-changed';
import { decisionTriggerReceived } from '../transforms/decision-trigger-received';

export function createHandlers() {
  const triggerHandlers = Object.fromEntries(
    TRIGGER_EVENT_TYPES.map((t) => [
      t,
      (payload: any, ctx: any) => decisionTriggerReceived(toUow(payload, ctx) as any),
    ]),
  );

  return {
    ...triggerHandlers,
    [DecisionWorkflowEventTypes.DECISION_PACKET_CREATED]: (payload: any, ctx: any) =>
      decisionPacketCreated(toUow(payload, ctx) as any),
    [DecisionWorkflowEventTypes.DECISION_PACKET_UPDATED]: (payload: any, ctx: any) =>
      decisionStatusChanged(toUow(payload, ctx) as any),
    [ComplianceEventTypes.DECISION_APPROVED]: (payload: any, ctx: any) =>
      decisionStatusChanged(toUow(payload, ctx) as any),
    [ComplianceEventTypes.DECISION_BLOCKED]: (payload: any, ctx: any) =>
      decisionStatusChanged(toUow(payload, ctx) as any),
    [DecisionWorkflowEventTypes.USER_CONFIRMATION_REQUESTED]: (payload: any, ctx: any) =>
      decisionStatusChanged(toUow(payload, ctx) as any),
  };
}

export const handler = materializeToTable({
  serviceName: 'advisory-bff',
  handlers: createHandlers(),
  errorEventType: 'ADVISORY_BFF_FAILED',
});
