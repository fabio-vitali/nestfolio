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

// DEPOSIT_INITIATED / WITHDRAWAL_INITIATED subjects are cross-domain (consumed by
// execution/broker-ctrl), so their contracts live in the producer's domain adapter:
// @nestfolio/investor-adpt/domain (DepositInitiatedSchema / WithdrawalInitiatedSchema).

/** Subject shape for INVESTOR_PROFILE_CREATED / INVESTOR_PROFILE_UPDATED. */
export const InvestorProfileUpdatedSchema = z.object({
  operatingMode: z.enum(['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE']),
  executionMode: z.enum(['simulation', 'live']).optional(),
  goal: InvestorProfileGoalSchema,
  riskProfile: InvestorProfileRiskSchema,
  onboardingCompletedAt: z.string().optional(),
  __version: z.number().optional(),
});
export type InvestorProfileUpdated = z.infer<typeof InvestorProfileUpdatedSchema>;

/** Subject shape for NOTIFICATION_READ — the investor-bff Notification read-model row
 * (sk='Notification#…'), projected from investor-ctrl's NOTIFICATION_CREATED
 * (transforms/notification-created.ts) and transitioned to READ by the
 * markNotificationRead resolver. Unconsumed cross-domain, so its home is here.
 * Dry subject — tenant/user identity travels in the event context, not here. */
export const NotificationReadSchema = z.object({
  notificationId: z.string(),
  channel: z.string(),
  title: z.string(),
  body: z.string(),
  relatedEntityType: z.string(),
  relatedEntityId: z.string(),
  status: z.string(),
  read: z.boolean().optional(),
  readAt: z.string().nullable().optional(),
  createdAt: z.string().optional(),
});
export type NotificationRead = z.infer<typeof NotificationReadSchema>;
