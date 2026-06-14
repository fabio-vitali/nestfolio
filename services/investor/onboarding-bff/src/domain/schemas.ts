import { z } from 'zod';

export const OnboardingPhaseSchema = z.enum([
  'goal', 'operating_mode', 'horizon', 'capital',
  'mandate_summary', 'mandate_consent', 'mandate_cta', 'completed',
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
});
export type Phases = z.infer<typeof PhasesSchema>;

export const OnboardingSessionSchema = z.object({
  sessionId: z.string().min(1),
  status: z.enum(['in_progress', 'completed', 'abandoned']),
  currentPhase: OnboardingPhaseSchema,
  phaseIndex: z.number().int().min(0).max(12),
  phases: PhasesSchema,
  agentMemorySessionId: z.string().min(1),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  ttl: z.number(),
});
export type OnboardingSession = z.infer<typeof OnboardingSessionSchema>;

/** Shape of the CDC record written on onboarding completion.
 *  Raw onboarding vocabulary — no investor-domain knowledge. */
export const OnboardingCompletedRecordSchema = z.object({
  // email is bundled onto the row when available; the wizard does not always
  // capture it (USER_REGISTERED also carries it), so it is optional and format
  // is not enforced at the consumer seam.
  email: z.string().optional(),
  goal: z.object({ objective: z.string() }),
  horizonYears: z.number().int().min(1).max(30),
  accountMode: z.enum(['simulation', 'live']),
  capitalAmount: z.number().nonnegative(),
  currency: z.string().length(3),
  // riskTolerance/riskExperience are the RAW tolerance/experience indices the
  // onboarding agent records on the row (compute-risk clamps to 0-3 only for its
  // own score derivation); the row can carry the un-clamped value, so the contract
  // accepts any number and the consumer's risk service normalizes it.
  riskTolerance: z.number(),
  riskExperience: z.number(),
  operatingMode: z.enum(['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE']),
  mandateAccepted: z.literal(true),
});
export type OnboardingCompletedRecord = z.infer<typeof OnboardingCompletedRecordSchema>;
