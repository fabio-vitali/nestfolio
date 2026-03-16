import { changeDataCapture, buildEventTypeMap } from '@nestfolio/event-processor';

export const handler = changeDataCapture({
  serviceName: 'execution-adpt',
  eventTypeMap: buildEventTypeMap(['VirtualTrade', 'VirtualCashBalance', 'VirtualPosition']),
});
