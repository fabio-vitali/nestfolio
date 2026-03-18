import { changeDataCapture } from '@nestfolio/event-processor';

export const handler = changeDataCapture({
  serviceName: 'advisory-narrative-ctrl',
  eventTypeMap: {
    'ReasoningOutput:INSERT': 'EXPLANATION_GENERATED',
  },
});
