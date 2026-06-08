// Producer-owned event payload contracts for investor-bff. Imports ONLY zod.
// InvestorProfile is the composite DDB row emitted as-is via CDC on
// INVESTOR_PROFILE_CREATED / INVESTOR_PROFILE_UPDATED.
import { z } from 'zod';

export const InvestorProfileGoalSchema = z.object({
  objective: z.string(),
  timeHorizonMonths: z.number().optional(),
  targetAmountCents: z.number().optional(),
  currency: z.string().optional(),
  targetReturn: z.number().optional(),
});
export type InvestorProfileGoal = z.infer<typeof InvestorProfileGoalSchema>;

export const InvestorProfileRiskSchema = z.object({
  // score is always computed by computeRiskProfile before the DDB Put —
  // it is guaranteed to be present on every row the CDC publishes.
  score: z.number(),
  // band is { minEquity, maxEquity } (object), not a string — mirror computeRiskProfile.
  band: z.object({ minEquity: z.number(), maxEquity: z.number() }).optional(),
  toleranceResponse: z.string().optional(),
  experienceLevel: z.string().optional(),
});
export type InvestorProfileRisk = z.infer<typeof InvestorProfileRiskSchema>;

/** Subject shape for INVESTOR_PROFILE_CREATED / INVESTOR_PROFILE_UPDATED. */
export const InvestorProfileSubjectSchema = z.object({
  tenantId: z.string(),
  userId: z.string(),
  operatingMode: z.enum(['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE']),
  goal: InvestorProfileGoalSchema,
  riskProfile: InvestorProfileRiskSchema,
  onboardingCompletedAt: z.string().optional(),
  __version: z.number().optional(),
});
export type InvestorProfileSubject = z.infer<typeof InvestorProfileSubjectSchema>;
