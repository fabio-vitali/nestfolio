import { createCommitPhaseTool } from '../../../src/agent/tools/commit-phase';

describe('createCommitPhaseTool', () => {
  const mockRepo = {
    updatePhase: jest.fn(),
    completeSession: jest.fn(),
  };

  const tool = createCommitPhaseTool(mockRepo as any);

  // Identity now flows via RunnableConfig.configurable, not the input schema.
  // tool.invoke(input, config) — LangChain forwards `config` as the 3rd
  // positional arg to the tool's `func`.
  const identityConfig = {
    configurable: { tenantId: 't1', userId: 'u1', sessionId: 's1' },
  };

  beforeEach(() => jest.clearAllMocks());

  it('has name commit_phase', () => {
    expect(tool.name).toBe('commit_phase');
  });

  it('schema does not expose identity fields to the LLM', () => {
    // Surface assertion: tenantId/userId/sessionId must not be in the JSON
    // schema the LLM sees. Closes the prompt-injection cross-tenant write
    // vector documented in 2026-04-29-onboarding-identity-propagation-design.
    const schemaShape = (tool.schema as any).shape ?? {};
    expect(schemaShape).not.toHaveProperty('tenantId');
    expect(schemaShape).not.toHaveProperty('userId');
    expect(schemaShape).not.toHaveProperty('sessionId');
  });

  it('calls updatePhase with identity from config.configurable for non-consent phases', async () => {
    const result = await tool.invoke({ phase: 'goal', data: { goal: 'growth' } }, identityConfig);
    expect(mockRepo.updatePhase).toHaveBeenCalledWith('t1', 'u1', 's1', 'goal', { goal: 'growth' }, 'operating_mode', 1);
    expect(mockRepo.completeSession).not.toHaveBeenCalled();
    expect(result).toContain('committed');
  });

  it('calls completeSession with identity from config.configurable for mandate_consent phase', async () => {
    const allPhases = {
      goal: { objective: 'growth' },
      operatingMode: { mode: 'BALANCED' },
      horizon: { years: 10 },
      capital: { amount: 50000, currency: 'EUR' },
      mandate: { accepted: true },
    };
    const result = await tool.invoke(
      { phase: 'mandate_consent', data: { mandateAccepted: true }, allPhases },
      identityConfig,
    );
    expect(mockRepo.completeSession).toHaveBeenCalledWith(
      's1', allPhases, expect.objectContaining({ tenantId: 't1', userId: 'u1' }),
    );
    expect(mockRepo.updatePhase).not.toHaveBeenCalled();
    expect(result).toContain('committed');
  });

  it('returns next phase name in result message', async () => {
    const result = await tool.invoke({ phase: 'horizon', data: { horizonYears: 10 } }, identityConfig);
    expect(result).toContain('Next: "capital"');
  });

  it('refuses to write when identity is missing on RunnableConfig.configurable', async () => {
    await expect(
      tool.invoke({ phase: 'goal', data: { goal: 'growth' } }, { configurable: {} }),
    ).rejects.toThrow(/identity missing/);
    expect(mockRepo.updatePhase).not.toHaveBeenCalled();
    expect(mockRepo.completeSession).not.toHaveBeenCalled();
  });

  it('refuses to write when only some identity fields are present', async () => {
    await expect(
      tool.invoke({ phase: 'goal', data: { goal: 'growth' } }, {
        configurable: { tenantId: 't1', userId: 'u1' /* missing sessionId */ },
      }),
    ).rejects.toThrow(/identity missing/);
    expect(mockRepo.updatePhase).not.toHaveBeenCalled();
  });
});
