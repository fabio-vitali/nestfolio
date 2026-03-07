import {
  getEscalationPath,
  getNextEscalation,
  HAIKU_ID,
  SONNET_ID,
  OPUS_ID,
} from './tier-escalation';

describe('getEscalationPath', () => {
  it('returns 3-step path for Haiku agents (user-goals)', () => {
    const path = getEscalationPath('user-goals');
    expect(path).toHaveLength(3);
    expect(path[0].modelId).toContain('haiku');
    expect(path[0].isEscalated).toBe(false);
    expect(path[1].modelId).toContain('sonnet');
    expect(path[1].isEscalated).toBe(true);
    expect(path[2].modelId).toContain('opus');
    expect(path[2].isEscalated).toBe(true);
  });

  it('returns 2-step path for Sonnet agents (market-research)', () => {
    const path = getEscalationPath('market-research');
    expect(path).toHaveLength(2);
    expect(path[0].modelId).toContain('sonnet');
    expect(path[0].isEscalated).toBe(false);
    expect(path[1].modelId).toContain('opus');
    expect(path[1].isEscalated).toBe(true);
  });

  it('returns 1-step path for Opus agents (risk-assessment)', () => {
    const path = getEscalationPath('risk-assessment');
    expect(path).toHaveLength(1);
    expect(path[0].modelId).toContain('opus');
    expect(path[0].isEscalated).toBe(false);
  });

  it('escalation levels are sequential from 0', () => {
    const path = getEscalationPath('user-goals');
    path.forEach((step, index) => {
      expect(step.escalationLevel).toBe(index);
    });
  });

  it('preserves temperature from primary config', () => {
    const path = getEscalationPath('user-goals');
    // user-goals has temperature 0.0
    for (const step of path) {
      expect(step.temperature).toBe(0.0);
    }
  });

  it('escalated models get at least 4096 maxTokens', () => {
    const path = getEscalationPath('user-goals');
    // user-goals primary has 2048, but escalated Sonnet/Opus should get at least 4096
    expect(path[0].maxTokens).toBe(2048); // Haiku keeps original
    expect(path[1].maxTokens).toBeGreaterThanOrEqual(4096); // Sonnet
    expect(path[2].maxTokens).toBeGreaterThanOrEqual(4096); // Opus
  });

  it('returns 2-step path for other Sonnet agents (rebalance-planner)', () => {
    const path = getEscalationPath('rebalance-planner');
    expect(path).toHaveLength(2);
    expect(path[0].modelId).toBe(SONNET_ID);
    expect(path[1].modelId).toBe(OPUS_ID);
  });

  it('returns 1-step path for other Opus agents (portfolio-construction)', () => {
    const path = getEscalationPath('portfolio-construction');
    expect(path).toHaveLength(1);
    expect(path[0].modelId).toBe(OPUS_ID);
  });
});

describe('getNextEscalation', () => {
  it('returns next step for Haiku model', () => {
    const next = getNextEscalation('user-goals', HAIKU_ID);
    expect(next).not.toBeNull();
    expect(next!.modelId).toContain('sonnet');
    expect(next!.isEscalated).toBe(true);
    expect(next!.escalationLevel).toBe(1);
  });

  it('returns Opus step after Sonnet for Haiku agent', () => {
    const next = getNextEscalation('user-goals', SONNET_ID);
    expect(next).not.toBeNull();
    expect(next!.modelId).toContain('opus');
    expect(next!.escalationLevel).toBe(2);
  });

  it('returns null for Opus model (already at max)', () => {
    const next = getNextEscalation('risk-assessment', OPUS_ID);
    expect(next).toBeNull();
  });

  it('returns null when current model is not in escalation path', () => {
    const next = getNextEscalation('user-goals', 'unknown-model-id');
    expect(next).toBeNull();
  });

  it('returns Opus for Sonnet agents at Sonnet tier', () => {
    const next = getNextEscalation('market-research', SONNET_ID);
    expect(next).not.toBeNull();
    expect(next!.modelId).toBe(OPUS_ID);
  });
});
