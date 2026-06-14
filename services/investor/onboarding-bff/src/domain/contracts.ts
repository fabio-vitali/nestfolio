/**
 * Onboarding-bff producer contracts — imported by consumers to type-check
 * their subject reads against the actual CDC payload shapes.
 *
 * Re-exported from schemas.ts (zod-only, no heavy deps) so both the producer
 * internals and external consumers resolve to the same canonical schema object.
 */

export {
  OnboardingCompletedRecordSchema,
  type OnboardingCompletedRecord,
} from './schemas';
