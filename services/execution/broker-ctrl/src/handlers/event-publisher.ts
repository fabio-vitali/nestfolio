import { changeDataCapture } from '@nestfolio/event-processor';

export const handler = changeDataCapture({
  serviceName: 'broker-ctrl',
  eventTypeMap: {
    'NormalizedEvent:INSERT': (record) => {
      const sk = record.sk as string ?? '';
      return sk; // sk IS the event type (ORDER_FILLED, ORDER_REJECTED, etc.)
    },
  },
});
