import { changeDataCapture } from '@nestfolio/event-processor';

export const handler = changeDataCapture({
  serviceName: 'market-intelligence-ctrl',
  eventTypeMap: {
    'AgentInvocation:INSERT': 'MARKET_SIGNAL_DETECTED',
  },
});
