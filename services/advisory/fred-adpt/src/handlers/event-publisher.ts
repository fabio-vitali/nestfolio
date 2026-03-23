import { changeDataCapture, buildEventTypeMap } from '@nestfolio/event-processor';
import { FredEntityTypes } from '../domain/events';

export const handler = changeDataCapture({
  serviceName: 'fred-adpt',
  eventTypeMap: buildEventTypeMap([...FredEntityTypes]),
});
