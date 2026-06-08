import { z } from 'zod';

export const OnboardingPhaseSchema = z.enum([
  'goal', 'operating_mode', 'horizon', 'capital',
  'mandate_summary', 'mandate_consent', 'mandate_cta', 'completed',
  'review_risk', 'review_goals', 'review_mandate', 'fund_account', 'go_live_confirmation',
]);
export type OnboardingPhase = z.infer<typeof OnboardingPhaseSchema>;

export const PhasesSchema = z.object({
  goal: z.object({ objective: z.string() }).optional(),
  horizon: z.object({ years: z.number().int().min(1).max(30) }).optional(),
  mode: z.object({ accountMode: z.enum(['simulation', 'live']) }).optional(),
  capital: z.object({ amount: z.number().nonnegative(), currency: z.string().length(3) }).optional(),
  risk: z.object({
    toleranceIdx: z.number().int().min(0).max(3),
    experienceIdx: z.number().int().min(0).max(3),
    score: z.number().int().min(0).max(100),       // display-only cached value
    category: z.enum(['conservative', 'moderate', 'aggressive']),  // display-only cached value
  }).optional(),
  operatingMode: z.object({ mode: z.enum(['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE']) }).optional(),
  mandate: z.object({ accepted: z.boolean() }).optional(),
  // Go-live phases
  review_risk: z.object({ confirmed: z.boolean() }).optional(),
  review_goals: z.object({ confirmed: z.boolean() }).optional(),
  review_mandate: z.object({ confirmed: z.boolean() }).optional(),
  fund_account: z.object({ amountCents: z.number().nonnegative(), currency: z.string().length(3) }).optional(),
  go_live_confirmation: z.object({ confirmed: z.boolean() }).optional(),
});
export type Phases = z.infer<typeof PhasesSchema>;

export const OnboardingSessionSchema = z.object({
  sessionId: z.string().min(1),
  status: z.enum(['in_progress', 'completed', 'abandoned']),
  flowType: z.enum(['initial', 'go-live']).default('initial'),
  currentPhase: OnboardingPhaseSchema,
  phaseIndex: z.number().int().min(0).max(12),
  phases: PhasesSchema,
  agentMemorySessionId: z.string().min(1),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  ttl: z.number(),
});
export type OnboardingSession = z.infer<typeof OnboardingSessionSchema>;

/** Shape of the CDC record written when investor confirms go-live.
 *  Emitted as GO_LIVE_CONFIRMED via CDC. */
export const GoLiveConfirmedRecordSchema = z.object({
  timestamp: z.string(),
});
export type GoLiveConfirmedRecord = z.infer<typeof GoLiveConfirmedRecordSchema>;

/** Shape of the CDC record written on onboarding completion.
 *  Raw onboarding vocabulary — no investor-domain knowledge. */
export const OnboardingCompletedRecordSchema = z.object({
  email: z.string().email(),
  goal: z.object({ objective: z.string() }),
  horizonYears: z.number().int().min(1).max(30),
  accountMode: z.enum(['simulation', 'live']),
  capitalAmount: z.number().nonnegative(),
  currency: z.string().length(3),
  riskTolerance: z.number().int().min(0).max(3),
  riskExperience: z.number().int().min(0).max(3),
  operatingMode: z.enum(['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE']),
  mandateAccepted: z.literal(true),
});
export type OnboardingCompletedRecord = z.infer<typeof OnboardingCompletedRecordSchema>;
