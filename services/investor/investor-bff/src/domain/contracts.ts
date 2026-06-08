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

/**
 * Subject shape for DEPOSIT_INITIATED.
 * Emitted from the `DepositIntent` DDB row (initiate-deposit.fn.js resolver).
 * Fields written: __typename, tenantId, userId, region, depositId, amountCents,
 * currency, status, initiatedAt, timestamp. userId is explicitly present.
 */
export const DepositInitiatedSubjectSchema = z.object({
  depositId: z.string(),
  amountCents: z.number().int().positive(),
  currency: z.string(),
  userId: z.string().optional(), // present; Cognito-supplied via stash
  tenantId: z.string(),
  region: z.string().optional(), // set from ctx.stash.region by the AppSync resolver
  status: z.string().optional(),
  initiatedAt: z.string().optional(),
  timestamp: z.string(),
});
export type DepositInitiatedSubject = z.infer<typeof DepositInitiatedSubjectSchema>;

/**
 * Subject shape for WITHDRAWAL_INITIATED (from WithdrawalIntent CDC row).
 * Emitted from the `WithdrawalIntent` DDB row (request-withdrawal.fn.js resolver).
 * Fields: __typename, tenantId, userId, region, withdrawalId, amountCents,
 * currency, status, requestedAt, timestamp.
 */
export const WithdrawalInitiatedSubjectSchema = z.object({
  withdrawalId: z.string(),
  amountCents: z.number().int().positive(),
  currency: z.string(),
  userId: z.string().optional(), // present; Cognito-supplied via stash
  tenantId: z.string(),
  region: z.string().optional(), // set from ctx.stash.region by the AppSync resolver
  status: z.string().optional(),
  requestedAt: z.string().optional(),
  timestamp: z.string(),
});
export type WithdrawalInitiatedSubject = z.infer<typeof WithdrawalInitiatedSubjectSchema>;

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
