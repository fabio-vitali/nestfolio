import { createCommitPhaseTool } from '../../src/agent/tools/commit-phase';

describe('createCommitPhaseTool', () => {
  const mockRepo = {
    updatePhase: jest.fn(),
    completeSession: jest.fn(),
  };

  const tool = createCommitPhaseTool(mockRepo as any);

  beforeEach(() => jest.clearAllMocks());

  it('has name commit_phase', () => {
    expect(tool.name).toBe('commit_phase');
  });

  it('calls updatePhase for non-mandate phases', async () => {
    const result = await tool.invoke({
      tenantId: 't1', userId: 'u1', sessionId: 's1',
      phase: 'goal', data: { objective: 'Growth' },
    });
    expect(mockRepo.updatePhase).toHaveBeenCalledWith('t1', 'u1', 's1', 'goal', { objective: 'Growth' }, 'horizon', 1);
    expect(mockRepo.completeSession).not.toHaveBeenCalled();
    expect(result).toContain('committed');
  });

  it('calls completeSession for mandate phase with allPhases', async () => {
    const allPhases = {
      goal: { objective: 'Growth' },
      horizon: { years: 5 },
      mode: { accountMode: 'simulation' },
      capital: { amount: 10000, currency: 'EUR' },
      risk: { toleranceIdx: 2, experienceIdx: 1, score: 50, category: 'moderate' },
      operatingMode: { mode: 'BALANCED' },
      mandate: { accepted: true },
    };
    const result = await tool.invoke({
      tenantId: 't1', userId: 'u1', sessionId: 's1',
      phase: 'mandate', data: { mandateAccepted: true }, allPhases,
    });
    expect(mockRepo.completeSession).toHaveBeenCalledWith('t1', 'u1', 's1', allPhases);
    expect(mockRepo.updatePhase).not.toHaveBeenCalled();
    expect(result).toContain('completed');
  });

  it('returns next phase name in result message', async () => {
    const result = await tool.invoke({
      tenantId: 't1', userId: 'u1', sessionId: 's1',
      phase: 'horizon', data: { years: 10 },
    });
    expect(result).toContain('Next: "mode"');
  });
});
