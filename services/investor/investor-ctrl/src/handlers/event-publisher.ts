import { changeDataCapture, buildEventTypeMap } from '@nestfolio/event-processor';

export const handler = changeDataCapture({
  serviceName: 'investor-ctrl',
  eventTypeMap: buildEventTypeMap(['Notification', 'MonthlyReport']),
});
