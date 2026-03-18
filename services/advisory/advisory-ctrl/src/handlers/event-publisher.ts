import { changeDataCapture, buildEventTypeMap } from '@nestfolio/event-processor';

export const handler = changeDataCapture({
  serviceName: 'advisory-ctrl',
  eventTypeMap: buildEventTypeMap(['DecisionPacket', 'AgentInvocation', 'WorkflowState']),
});
