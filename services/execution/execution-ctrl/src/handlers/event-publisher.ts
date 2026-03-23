import { changeDataCapture, buildEventTypeMap } from '@nestfolio/event-processor';
import type { StreamRecord } from '@nestfolio/event-processor';

export const handler = changeDataCapture({
  serviceName: 'execution-ctrl',
  eventTypeMap: {
    ...buildEventTypeMap(['Order', 'StagedOrder']),
    'Order:INSERT': (record: StreamRecord) => {
      switch (record['status']) {
        case 'SUBMITTED': return 'ORDER_SUBMITTED';
        case 'STAGED':    return 'ORDER_STAGED';
        case 'REJECTED':  return 'ORDER_REJECTED';
        default:          return 'ORDER_CREATED';
      }
    },
  },
});
