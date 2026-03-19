import { z } from 'zod';

export const OnboardingPhaseSchema = z.enum([
  'goal', 'horizon', 'mode', 'capital', 'risk', 'operating_mode', 'mandate', 'completed',
]);
export type OnboardingPhase = z.infer<typeof OnboardingPhaseSchema>;

export const AccountModeSchema = z.object({
  mode: z.enum(['simulation', 'live']),
  capitalAmount: z.number().nonnegative(),
  currency: z.string().min(3).max(3),
});
export type AccountMode = z.infer<typeof AccountModeSchema>;

export const OnboardingSessionSchema = z.object({
  sessionId: z.string().min(1),
  currentPhase: OnboardingPhaseSchema,
  phaseIndex: z.number().int().min(0).max(7),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  agentMemorySessionId: z.string().min(1),
});
export type OnboardingSession = z.infer<typeof OnboardingSessionSchema>;

export const RiskProfileDataSchema = z.object({
  tolerance: z.string(),
  experienceLevel: z.string(),
  score: z.number().int().min(0).max(100),
  category: z.enum(['conservative', 'moderate', 'aggressive']),
});
export type RiskProfileData = z.infer<typeof RiskProfileDataSchema>;
