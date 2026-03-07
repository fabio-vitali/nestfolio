import { getModelConfig, AGENT_TYPES, AgentType } from './model-config';

describe('getModelConfig', () => {
  it.each(AGENT_TYPES)('returns a valid config for agent type "%s"', (agentType) => {
    const config = getModelConfig(agentType);

    expect(config).toBeDefined();
    expect(typeof config.modelId).toBe('string');
    expect(config.modelId.length).toBeGreaterThan(0);
    expect(typeof config.maxTokens).toBe('number');
    expect(config.maxTokens).toBeGreaterThan(0);
    expect(typeof config.temperature).toBe('number');
    expect(config.temperature).toBeGreaterThanOrEqual(0);
    expect(config.temperature).toBeLessThanOrEqual(1);
  });

  it('returns the correct model for user-goals', () => {
    const config = getModelConfig('user-goals');
    expect(config.modelId).toContain('haiku');
    expect(config.maxTokens).toBe(2048);
    expect(config.temperature).toBe(0.0);
  });

  it('returns the correct model for risk-assessment', () => {
    const config = getModelConfig('risk-assessment');
    expect(config.modelId).toContain('opus');
    expect(config.maxTokens).toBe(4096);
    expect(config.temperature).toBe(0.1);
  });

  it('returns the correct model for explainability', () => {
    const config = getModelConfig('explainability');
    expect(config.modelId).toContain('sonnet');
    expect(config.maxTokens).toBe(8192);
    expect(config.temperature).toBe(0.3);
  });

  it('throws for an unknown agent type', () => {
    expect(() => getModelConfig('unknown' as AgentType)).toThrow(
      'Unknown agent type: unknown',
    );
  });
});
