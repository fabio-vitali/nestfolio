import { z } from 'zod';
import { Annotation } from '@langchain/langgraph';
import { BaseMessage } from '@langchain/core/messages';
import { RiskProfileDataSchema } from '../domain/schemas';

export const PHASE_ORDER = ['goal', 'horizon', 'mode', 'capital', 'risk', 'operating_mode', 'mandate'] as const;
export type Phase = (typeof PHASE_ORDER)[number];

export function phaseIndexOf(phase: Phase): number {
  return PHASE_ORDER.indexOf(phase);
}

export function nextPhase(current: Phase): Phase | 'completed' {
  const idx = PHASE_ORDER.indexOf(current);
  return idx < PHASE_ORDER.length - 1 ? PHASE_ORDER[idx + 1] : 'completed';
}

export const OnboardingStateSchema = z.object({
  phase: z.enum(PHASE_ORDER),
  phaseIndex: z.number().int().min(0).max(6),
  totalPhases: z.literal(7),
  goal: z.string().optional(),
  horizonYears: z.number().int().min(1).max(30).optional(),
  accountMode: z.enum(['simulation', 'live']).optional(),
  capitalAmount: z.number().nonnegative().optional(),
  riskProfile: RiskProfileDataSchema.optional(),
  operatingMode: z.enum(['conservative', 'balanced', 'aggressive']).optional(),
  mandateAccepted: z.boolean().optional(),
  turnCount: z.number().int().min(0).default(0),
  messages: z.array(z.any()),
});

export const MAX_TURNS = 50;

export const OnboardingAnnotation = Annotation.Root({
  phase: Annotation<Phase>({ reducer: (_, v) => v, default: () => 'goal' }),
  phaseIndex: Annotation<number>({ reducer: (_, v) => v, default: () => 0 }),
  totalPhases: Annotation<number>({ reducer: (_, v) => v, default: () => 7 }),
  goal: Annotation<string | undefined>({ reducer: (_, v) => v, default: () => undefined }),
  horizonYears: Annotation<number | undefined>({ reducer: (_, v) => v, default: () => undefined }),
  accountMode: Annotation<'simulation' | 'live' | undefined>({ reducer: (_, v) => v, default: () => undefined }),
  capitalAmount: Annotation<number | undefined>({ reducer: (_, v) => v, default: () => undefined }),
  riskProfile: Annotation<Record<string, unknown> | undefined>({ reducer: (_, v) => v, default: () => undefined }),
  operatingMode: Annotation<string | undefined>({ reducer: (_, v) => v, default: () => undefined }),
  mandateAccepted: Annotation<boolean | undefined>({ reducer: (_, v) => v, default: () => undefined }),
  turnCount: Annotation<number>({ reducer: (prev, next) => prev + next, default: () => 0 }),
  messages: Annotation<BaseMessage[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  sessionId: Annotation<string | undefined>({ reducer: (_, v) => v, default: () => undefined }),
  tenantId: Annotation<string | undefined>({ reducer: (_, v) => v, default: () => undefined }),
  userId: Annotation<string | undefined>({ reducer: (_, v) => v, default: () => undefined }),
});
