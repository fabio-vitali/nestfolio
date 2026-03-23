import { changeDataCapture, buildEventTypeMap } from '@nestfolio/event-processor';

export const handler = changeDataCapture({
  serviceName: 'decision-workflow-ctrl',
  eventTypeMap: buildEventTypeMap(['DecisionPacket', 'AgentOutput', 'WorkflowTrigger']),
});
