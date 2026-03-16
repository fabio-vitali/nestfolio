import { changeDataCapture, buildEventTypeMap } from '@nestfolio/event-processor';

export const handler = changeDataCapture({
  serviceName: 'advisory-bff',
  eventTypeMap: buildEventTypeMap(['DecisionReadModel', 'UserInteraction', 'UserConfirmation', 'UserRejection']),
});
