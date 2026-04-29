import { rehydrateState } from '../../../src/agent/session';

describe('rehydrateState', () => {
  it('returns initial state when no session exists', () => {
    const state = rehydrateState(null);
    expect(state.phase).toBe('goal');
    expect(state.phaseIndex).toBe(0);
  });

  it('resumes from operating_mode phase with goal data', () => {
    const session = {
      currentPhase: 'operating_mode', phaseIndex: 1, sessionId: 's1', agentMemorySessionId: 'm1',
      phases: { goal: { objective: 'growth' } },
    };
    const state = rehydrateState(session);
    expect(state.phase).toBe('operating_mode');
    expect(state.phaseIndex).toBe(1);
    expect(state.goal).toBe('growth');
    // sessionId is no longer rehydrated into agent state — it is bound to
    // the runtime invocation via RunnableConfig.configurable, not carried in
    // the LLM-visible state.
    expect(state.sessionId).toBeUndefined();
  });

  it('resumes from capital phase with prior phases', () => {
    const session = {
      currentPhase: 'capital', phaseIndex: 3, sessionId: 's2', agentMemorySessionId: 'm2',
      phases: {
        goal: { objective: 'retirement' },
        operatingMode: { mode: 'BALANCED' },
        horizon: { years: 20 },
      },
    };
    const state = rehydrateState(session);
    expect(state.phase).toBe('capital');
    expect(state.horizonYears).toBe(20);
    expect(state.operatingMode).toBe('balanced');
  });

  it('marks completed sessions', () => {
    const session = {
      currentPhase: 'completed', phaseIndex: 7, sessionId: 's3', agentMemorySessionId: 'm3',
      phases: {},
    };
    const state = rehydrateState(session);
    expect(state.phase).toBe('completed');
  });
});
