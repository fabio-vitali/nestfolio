import { createCommitPhaseTool } from '../../../src/agent/tools/commit-phase';

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

  it('calls updatePhase for non-consent phases', async () => {
    const result = await tool.invoke({
      tenantId: 't1', userId: 'u1', sessionId: 's1',
      phase: 'goal', data: { goal: 'growth' },
    });
    expect(mockRepo.updatePhase).toHaveBeenCalledWith('t1', 'u1', 's1', 'goal', { goal: 'growth' }, 'operating_mode', 1);
    expect(mockRepo.completeSession).not.toHaveBeenCalled();
    expect(result).toContain('committed');
  });

  it('calls completeSession for mandate_consent phase with allPhases', async () => {
    const allPhases = {
      goal: { objective: 'growth' },
      operatingMode: { mode: 'BALANCED' },
      horizon: { years: 10 },
      capital: { amount: 50000, currency: 'EUR' },
      mandate: { accepted: true },
    };
    const result = await tool.invoke({
      tenantId: 't1', userId: 'u1', sessionId: 's1',
      phase: 'mandate_consent', data: { mandateAccepted: true }, allPhases,
    });
    expect(mockRepo.completeSession).toHaveBeenCalledWith(
      's1', allPhases, expect.objectContaining({ tenantId: 't1', userId: 'u1' }),
    );
    expect(mockRepo.updatePhase).not.toHaveBeenCalled();
    expect(result).toContain('committed');
  });

  it('returns next phase name in result message', async () => {
    const result = await tool.invoke({
      tenantId: 't1', userId: 'u1', sessionId: 's1',
      phase: 'horizon', data: { horizonYears: 10 },
    });
    expect(result).toContain('Next: "capital"');
  });
});
