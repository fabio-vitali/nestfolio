import { changeDataCapture, buildEventTypeMap } from '@nestfolio/event-processor';

export const handler = changeDataCapture({
  serviceName: 'onboarding-bff',
  eventTypeMap: buildEventTypeMap(
    ['OnboardingCompleted', 'GoLiveConfirmed'],
    {
      'OnboardingCompleted:INSERT': 'ONBOARDING_COMPLETED',
      'GoLiveConfirmed:INSERT': 'GO_LIVE_CONFIRMED',
    },
  ),
});
