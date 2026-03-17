import { changeDataCapture } from '@nestfolio/event-processor';

export const handler = changeDataCapture({
  serviceName: 'portfolio-engine-ctrl',
  eventTypeMap: {
    'AgentInvocation:INSERT': 'PORTFOLIO_CONSTRUCTION_PROPOSED',
    'ReasoningOutput:INSERT': 'REBALANCE_PLAN_PRODUCED',
  },
});
