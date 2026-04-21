import { eventName } from '@nestfolio/event-types';

export const ONBOARDING_STARTED = eventName('ONBOARDING_STARTED');
export const ONBOARDING_COMPLETED = eventName('ONBOARDING_COMPLETED');
export const GO_LIVE_CONFIRMED = eventName('GO_LIVE_CONFIRMED');

export const OnboardingBffEventTypes = {
  ONBOARDING_AGENT_INVOCATION_TRACED: eventName('ONBOARDING_AGENT_INVOCATION_TRACED'),
} as const;
