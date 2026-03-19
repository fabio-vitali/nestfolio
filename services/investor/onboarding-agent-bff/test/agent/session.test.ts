import { rehydrateState } from '../../src/agent/session';

describe('rehydrateState', () => {
  it('returns initial state when no session exists', () => {
    const state = rehydrateState(null, {});
    expect(state.phase).toBe('goal');
    expect(state.phaseIndex).toBe(0);
  });

  it('resumes from horizon phase with goal data', () => {
    const session = { currentPhase: 'horizon', phaseIndex: 1, sessionId: 's1', agentMemorySessionId: 'm1' };
    const committed = { goal: { objective: 'Crescita' } };
    const state = rehydrateState(session, committed);
    expect(state.phase).toBe('horizon');
    expect(state.phaseIndex).toBe(1);
    expect(state.goal).toBe('Crescita');
    expect(state.sessionId).toBe('s1');
  });

  it('resumes from capital phase with goal + horizon + mode data', () => {
    const session = { currentPhase: 'capital', phaseIndex: 3, sessionId: 's2', agentMemorySessionId: 'm2' };
    const committed = {
      goal: { objective: 'Pensione' },
      horizonYears: 20,
      accountMode: { mode: 'simulation' },
    };
    const state = rehydrateState(session, committed);
    expect(state.phase).toBe('capital');
    expect(state.horizonYears).toBe(20);
    expect(state.accountMode).toBe('simulation');
  });

  it('marks completed sessions', () => {
    const session = { currentPhase: 'completed', phaseIndex: 7, sessionId: 's3', agentMemorySessionId: 'm3' };
    const state = rehydrateState(session, {});
    expect(state.phase).toBe('completed');
  });
});
