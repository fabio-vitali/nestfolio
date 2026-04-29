import type { Phase } from './state';

interface SessionRecord {
  currentPhase: string;
  phaseIndex: number;
  sessionId: string;
  agentMemorySessionId: string;
  phases: Record<string, unknown>;
}

export function rehydrateState(session: SessionRecord | null): Record<string, unknown> {
  if (!session) {
    return { phase: 'goal' as Phase, phaseIndex: 0, totalPhases: 7, turnCount: 0, messages: [] };
  }

  const p = session.phases ?? {};
  const goal = p.goal as { objective: string } | undefined;
  const horizon = p.horizon as { years: number } | undefined;
  const capital = p.capital as { amount: number } | undefined;
  const opMode = p.operatingMode as { mode: string } | undefined;

  return {
    phase: session.currentPhase as Phase,
    phaseIndex: session.phaseIndex,
    totalPhases: 7,
    turnCount: 0,
    goal: goal?.objective,
    horizonYears: horizon?.years,
    capitalAmount: capital?.amount,
    operatingMode: opMode?.mode?.toLowerCase(),
    messages: [],
  };
}
