import { createCommitPhaseTool } from '../../src/agent/tools/commit-phase';

describe('createCommitPhaseTool', () => {
  const mockRepo = {
    commitGoal: jest.fn(),
    commitHorizon: jest.fn(),
    commitAccountMode: jest.fn(),
    commitRiskProfile: jest.fn(),
    commitOperatingMode: jest.fn(),
    commitMandate: jest.fn(),
    advanceSession: jest.fn(),
  };

  const tool = createCommitPhaseTool(mockRepo as any);

  beforeEach(() => jest.clearAllMocks());

  it('has name commit_phase', () => {
    expect(tool.name).toBe('commit_phase');
  });

  it('commits goal phase and advances session', async () => {
    const result = await tool.invoke({
      tenantId: 't1', userId: 'u1', sessionId: 's1',
      phase: 'goal', data: { goal: 'Crescita' },
    });
    expect(mockRepo.commitGoal).toHaveBeenCalledWith('t1', 'u1', 'Crescita');
    expect(mockRepo.advanceSession).toHaveBeenCalledWith('t1', 'u1', 's1', 'horizon', 1);
    expect(result).toContain('committed');
  });

  it('commits horizon phase', async () => {
    await tool.invoke({
      tenantId: 't1', userId: 'u1', sessionId: 's1',
      phase: 'horizon', data: { horizonYears: 10 },
    });
    expect(mockRepo.commitHorizon).toHaveBeenCalledWith('t1', 'u1', 10);
    expect(mockRepo.advanceSession).toHaveBeenCalledWith('t1', 'u1', 's1', 'mode', 2);
  });

  it('commits mode + capital as single phase', async () => {
    await tool.invoke({
      tenantId: 't1', userId: 'u1', sessionId: 's1',
      phase: 'mode', data: { accountMode: 'simulation' },
    });
    expect(mockRepo.commitAccountMode).toHaveBeenCalled();
  });

  it('commits mandate and advances to completed', async () => {
    await tool.invoke({
      tenantId: 't1', userId: 'u1', sessionId: 's1',
      phase: 'mandate', data: { mandateAccepted: true },
    });
    expect(mockRepo.commitMandate).toHaveBeenCalledWith('t1', 'u1');
    expect(mockRepo.advanceSession).toHaveBeenCalledWith('t1', 'u1', 's1', 'completed', 7);
  });
});
