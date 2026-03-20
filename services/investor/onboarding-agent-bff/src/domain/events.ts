export const ONBOARDING_STARTED = 'ONBOARDING_STARTED' as const;
export const ONBOARDING_COMPLETED = 'ONBOARDING_COMPLETED' as const;

export type OnboardingEventType = typeof ONBOARDING_STARTED | typeof ONBOARDING_COMPLETED;
