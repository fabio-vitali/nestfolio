import { buildDecisionGraph, AgentNodeMap } from './graph-orchestrator';
import { AgentType } from './model-config';

describe('buildDecisionGraph', () => {
  function createMockNodeMap(): AgentNodeMap {
    const agentTypes: AgentType[] = [
      'user-goals',
      'risk-assessment',
      'market-research',
      'portfolio-construction',
      'rebalance-planner',
      'explainability',
    ];

    const nodeMap = {} as AgentNodeMap;

    for (const agentType of agentTypes) {
      nodeMap[agentType] = jest.fn().mockResolvedValue({
        [agentType]: { mock: true, agent: agentType },
      });
    }

    return nodeMap;
  }

  it('returns a compiled graph with an invoke method', () => {
    const nodeMap = createMockNodeMap();
    const graph = buildDecisionGraph(nodeMap);

    expect(graph).toBeDefined();
    expect(typeof graph.invoke).toBe('function');
  });

  it('invokes all agent nodes during graph execution', async () => {
    const nodeMap = createMockNodeMap();
    const graph = buildDecisionGraph(nodeMap);

    const result = await graph.invoke({ input: 'test input' });

    // All six agents should have been called
    for (const agentType of Object.keys(nodeMap)) {
      expect(nodeMap[agentType as AgentType]).toHaveBeenCalled();
    }

    // The result should contain keys from all agents
    expect(result).toHaveProperty('user-goals');
    expect(result).toHaveProperty('risk-assessment');
    expect(result).toHaveProperty('market-research');
    expect(result).toHaveProperty('portfolio-construction');
    expect(result).toHaveProperty('rebalance-planner');
    expect(result).toHaveProperty('explainability');
  });

  it('executes waves in the correct order', async () => {
    const callOrder: string[] = [];
    const nodeMap = {} as AgentNodeMap;

    const agentTypes: AgentType[] = [
      'user-goals',
      'risk-assessment',
      'market-research',
      'portfolio-construction',
      'rebalance-planner',
      'explainability',
    ];

    for (const agentType of agentTypes) {
      nodeMap[agentType] = jest.fn().mockImplementation(async () => {
        callOrder.push(agentType);
        return { [agentType]: { mock: true } };
      });
    }

    const graph = buildDecisionGraph(nodeMap);
    await graph.invoke({ input: 'test' });

    // Wave 1 agents must come before wave 2 agents
    const wave1Agents = ['user-goals', 'risk-assessment', 'market-research'];
    const wave2Agents = ['portfolio-construction', 'rebalance-planner'];
    const wave3Agents = ['explainability'];

    const wave1MaxIndex = Math.max(
      ...wave1Agents.map((a) => callOrder.indexOf(a)),
    );
    const wave2MinIndex = Math.min(
      ...wave2Agents.map((a) => callOrder.indexOf(a)),
    );
    const wave3MinIndex = Math.min(
      ...wave3Agents.map((a) => callOrder.indexOf(a)),
    );

    expect(wave1MaxIndex).toBeLessThan(wave2MinIndex);
    expect(wave2MinIndex).toBeLessThan(wave3MinIndex);
  });
});
