import { StateGraph } from '@langchain/langgraph';
import type { OrchestratorConfig } from './types';
import { createAgentNode } from './agent-factory';
import { withValidation, type AgentNodeFn } from './with-validation';
import { withRetry } from './with-retry';
import { withFallback } from './with-fallback';
import { buildEscalationPath } from './tier-escalation';

export interface CompiledGraph {
  invoke(input: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export function createOrchestrator<K extends string, TState>(
  config: OrchestratorConfig<K, TState>,
): CompiledGraph {
  const { waves, stateAnnotation, agents, fallbacks, validationRules, retryOptions } = config;
  const defaultRetry = retryOptions ?? { maxAttempts: 3 };

  // Validate all wave agent keys exist in agents config
  for (const wave of waves) {
    for (const agentKey of wave.agents) {
      if (!(agentKey in agents)) {
        throw new Error(`Unknown agent key "${agentKey}" in wave definition`);
      }
    }
  }

  // Build decorated node for each agent
  const nodeMap: Record<string, AgentNodeFn> = {};
  for (const [key, agentConfig] of Object.entries(agents) as [K, typeof agents[K]][]) {
    let node: AgentNodeFn = createAgentNode(agentConfig);

    if (validationRules?.[key]) {
      node = withValidation(node, validationRules[key]);
    }

    // Determine escalation path from model ID
    const tier = agentConfig.modelId.includes('haiku') ? 'haiku'
      : agentConfig.modelId.includes('opus') ? 'opus' : 'sonnet';
    const escalationPath = buildEscalationPath(tier as any);

    node = withRetry(node, { ...defaultRetry, escalationPath });

    if (fallbacks?.[key]) {
      node = withFallback(node, fallbacks[key] as any);
    }

    nodeMap[key] = node;
  }

  // Build wave nodes (parallel agents within each wave)
  const waveNodes: Array<{ name: string; fn: AgentNodeFn }> = waves.map((wave, idx) => ({
    name: `wave${idx}`,
    fn: async (state: Record<string, unknown>) => {
      const results = await Promise.all(
        wave.agents.map(async (agentKey) => {
          const output = await nodeMap[agentKey](state);
          return { [agentKey]: output };
        }),
      );
      return Object.assign({}, ...results);
    },
  }));

  // Build the StateGraph
  const graph = new StateGraph(stateAnnotation as any);

  for (const waveNode of waveNodes) {
    graph.addNode(waveNode.name, waveNode.fn);
  }

  // Wire edges: __start__ → wave0 → wave1 → ... → waveN → __end__
  (graph as any).addEdge('__start__', waveNodes[0].name);
  for (let i = 0; i < waveNodes.length - 1; i++) {
    (graph as any).addEdge(waveNodes[i].name, waveNodes[i + 1].name);
  }
  (graph as any).addEdge(waveNodes[waveNodes.length - 1].name, '__end__');

  return graph.compile() as unknown as CompiledGraph;
}
