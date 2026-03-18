import { changeDataCapture } from '@nestfolio/event-processor';

export const handler = changeDataCapture({
  serviceName: 'investor-profile-ctrl',
  eventTypeMap: {
    'AgentInvocation:INSERT': 'GOAL_INTERPRETATION_PRODUCED',
    'ReasoningOutput:INSERT': 'RISK_EVALUATION_PRODUCED',
  },
});
