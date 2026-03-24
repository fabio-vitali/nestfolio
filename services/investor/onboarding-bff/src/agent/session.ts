import type { Phase } from './state';

interface SessionRecord {
  currentPhase: string;
  phaseIndex: number;
  sessionId: string;
  agentMemorySessionId: string;
}

interface CommittedData {
  goal?: { objective: string };
  horizonYears?: number;
  accountMode?: { mode: 'simulation' | 'live'; capitalAmount?: number };
  riskProfile?: Record<string, unknown>;
  operatingMode?: string;
}

export function rehydrateState(
  session: SessionRecord | null,
  committed: CommittedData,
): Record<string, unknown> {
  if (!session) {
    return {
      phase: 'goal' as Phase,
      phaseIndex: 0,
      totalPhases: 7,
      turnCount: 0,
      messages: [],
    };
  }

  return {
    phase: session.currentPhase as Phase,
    phaseIndex: session.phaseIndex,
    totalPhases: 7,
    turnCount: 0,
    sessionId: session.sessionId,
    goal: committed.goal?.objective,
    horizonYears: committed.horizonYears,
    accountMode: committed.accountMode?.mode,
    capitalAmount: committed.accountMode?.capitalAmount,
    riskProfile: committed.riskProfile,
    operatingMode: committed.operatingMode,
    messages: [],
  };
}
