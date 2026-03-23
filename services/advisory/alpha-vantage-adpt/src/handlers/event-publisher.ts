import { changeDataCapture, buildEventTypeMap } from '@nestfolio/event-processor';
import { AlphaVantageEntityTypes } from '../domain/events';

export const handler = changeDataCapture({
  serviceName: 'alpha-vantage-adpt',
  eventTypeMap: buildEventTypeMap([...AlphaVantageEntityTypes]),
});
