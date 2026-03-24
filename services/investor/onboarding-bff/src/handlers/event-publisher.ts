import { changeDataCapture, buildEventTypeMap } from '@nestfolio/event-processor';

export const handler = changeDataCapture({
  serviceName: 'onboarding-bff',
  eventTypeMap: buildEventTypeMap(
    ['OnboardingCompleted'],
    { 'OnboardingCompleted:INSERT': 'ONBOARDING_COMPLETED' },
  ),
});
