import { changeDataCapture, buildEventTypeMap } from '@nestfolio/event-processor';
import { MarketwatchEntityTypes } from '../domain/events';

export const handler = changeDataCapture({
  serviceName: 'marketwatch-adpt',
  eventTypeMap: buildEventTypeMap([...MarketwatchEntityTypes]),
});
