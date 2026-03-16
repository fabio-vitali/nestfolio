import { changeDataCapture, buildEventTypeMap } from '@nestfolio/event-processor';

export const handler = changeDataCapture({
  serviceName: 'execution-ctrl',
  eventTypeMap: buildEventTypeMap(['Order', 'StagedOrder']),
});
