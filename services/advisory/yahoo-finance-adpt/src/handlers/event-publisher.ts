import { changeDataCapture, buildEventTypeMap } from '@nestfolio/event-processor';
import { YahooFinanceEntityTypes } from '../domain/events';

export const handler = changeDataCapture({
  serviceName: 'yahoo-finance-adpt',
  eventTypeMap: buildEventTypeMap([...YahooFinanceEntityTypes]),
});
