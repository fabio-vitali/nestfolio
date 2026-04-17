import { AGENT_CONFIGS, AGENT_TYPES, DECISION_LIFECYCLE_WAVES } from '../../../src/agents/config';

describe('agent config', () => {
  it('has configs for all 6 agent types', () => {
    expect(Object.keys(AGENT_CONFIGS)).toHaveLength(6);
    for (const type of AGENT_TYPES) {
      expect(AGENT_CONFIGS[type]).toBeDefined();
      expect(AGENT_CONFIGS[type].modelId).toBeTruthy();
      expect(AGENT_CONFIGS[type].schema).toBeDefined();
      expect(AGENT_CONFIGS[type].promptTemplate).toBeTruthy();
    }
  });

  it('has 3 waves with correct dependencies', () => {
    expect(DECISION_LIFECYCLE_WAVES).toHaveLength(3);
    expect(DECISION_LIFECYCLE_WAVES[0].agents).toEqual(['user-goals', 'risk-assessment', 'market-research']);
    expect(DECISION_LIFECYCLE_WAVES[0].dependsOn).toBeUndefined();
    expect(DECISION_LIFECYCLE_WAVES[1].dependsOn).toEqual(['user-goals', 'risk-assessment', 'market-research']);
    expect(DECISION_LIFECYCLE_WAVES[2].dependsOn).toEqual(['portfolio-construction', 'rebalance-planner']);
  });
});
