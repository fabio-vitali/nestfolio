import { StateGraph } from '@langchain/langgraph';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { OrchestratorConfig } from './types';
import { createAgentNode } from './agent-factory';
import { withValidation, type AgentNodeFn } from './with-validation';
import { withRetry } from './with-retry';
import { withFallback, type AgentNodeWithFallback } from './with-fallback';

export interface CompiledGraph {
  invoke(
    input: Record<string, unknown>,
    config?: RunnableConfig,
  ): Promise<Record<string, unknown>>;
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

  // Build decorated node for each agent. Phase β (Spec 4, 2026-05-06):
  // every entry of nodeMap returns AgentNodeResult so the wave-node output
  // marks degraded agents discriminantly; downstream consumers must check
  // `.ok` before using `.output` (or `.fallback`).
  const nodeMap: Record<string, AgentNodeWithFallback> = {};
  for (const [key, agentConfig] of Object.entries(agents) as [K, typeof agents[K]][]) {
    let bareNode: AgentNodeFn = createAgentNode(agentConfig);

    if (validationRules?.[key]) {
      bareNode = withValidation(bareNode, validationRules[key]);
    }

    bareNode = withRetry(bareNode, defaultRetry);

    if (fallbacks?.[key]) {
      nodeMap[key] = withFallback(bareNode, fallbacks[key] as any);
    } else {
      // Adapter: a node without an explicit fallback still surfaces ok/error
      // via the same union shape so the wave node accumulator does not need
      // to special-case an absent fallback.
      const innerNode = bareNode;
      nodeMap[key] = async (state, runnableConfig) => {
        try {
          const output = await innerNode(state, runnableConfig);
          return { ok: true, output };
        } catch (err) {
          const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
          return { ok: false, reason, fallback: {} };
        }
      };
    }
  }

  // Build wave nodes (parallel agents within each wave). Each wave returns
  // an object whose values are AgentNodeResult so consumers can check `.ok`.
  type WaveNodeFn = (state: Record<string, unknown>) => Promise<Record<string, unknown>>;
  const waveNodes: Array<{ name: string; fn: WaveNodeFn }> = waves.map((wave, idx) => ({
    name: `wave${idx}`,
    fn: async (state: Record<string, unknown>) => {
      const results = await Promise.all(
        wave.agents.map(async (agentKey) => {
          const result = await nodeMap[agentKey](state);
          return { [agentKey]: result };
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
