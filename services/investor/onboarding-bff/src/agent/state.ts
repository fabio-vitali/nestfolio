import { z } from 'zod';
import { Annotation } from '@langchain/langgraph';
import { BaseMessage } from '@langchain/core/messages';

export const PHASE_ORDER = [
  'goal',
  'operating_mode',
  'horizon',
  'capital',
  'mandate_summary',
  'mandate_consent',
  'mandate_cta',
] as const;
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
  operatingMode: z.enum(['conservative', 'balanced', 'aggressive']).optional(),
  horizonYears: z.number().int().min(1).max(30).optional(),
  capitalAmount: z.number().nonnegative().optional(),
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
  operatingMode: Annotation<string | undefined>({ reducer: (_, v) => v, default: () => undefined }),
  horizonYears: Annotation<number | undefined>({ reducer: (_, v) => v, default: () => undefined }),
  capitalAmount: Annotation<number | undefined>({ reducer: (_, v) => v, default: () => undefined }),
  mandateAccepted: Annotation<boolean | undefined>({ reducer: (_, v) => v, default: () => undefined }),
  turnCount: Annotation<number>({ reducer: (prev, next) => prev + next, default: () => 0 }),
  // Retry telemetry — summed across all phase-node invocations in a single
  // browser turn. Surfaced via `OnboardingAgent stream complete` log line in
  // agents/onboarding/agent.ts. Steady-state expectation: 0. Non-zero signals
  // a model-behavior change or prompt regression.
  phaseRetryCount: Annotation<number>({ reducer: (prev, next) => prev + next, default: () => 0 }),
  phaseFailures: Annotation<Array<{ phase: string; firstAttemptTool: string | null; expectedTool: string }>>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  messages: Annotation<BaseMessage[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  // Identity (tenantId, userId, sessionId) is intentionally NOT held in graph
  // state. It is bound to the runtime invocation via
  // RunnableConfig.configurable (see agents/onboarding/server.ts) so the LLM
  // never sees it and cannot supply or override it.
});
