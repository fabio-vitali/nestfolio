/**
 * Onboarding-bff producer contracts — imported by consumers to type-check
 * their subject reads against the actual CDC payload shapes.
 *
 * Re-exported from schemas.ts (zod-only, no heavy deps) so both the producer
 * internals and external consumers resolve to the same canonical schema object.
 */
import type { ZodTypeAny } from 'zod';
import { OnboardingCompletedRecordSchema } from './schemas';

export {
  OnboardingCompletedRecordSchema,
  type OnboardingCompletedRecord,
} from './schemas';

/** Test-fixture event→subject map for onboarding-bff. Consumed only by @nestfolio/test-contracts. */
export const onboardingBffEventSubjects = {
  ONBOARDING_COMPLETED: OnboardingCompletedRecordSchema,
} as const satisfies Record<string, ZodTypeAny>;
