import { StateGraph, Annotation } from '@langchain/langgraph';

import { AgentType } from './model-config';
import { AgentNodeFn } from './agent-factory';

/**
 * The annotation (state schema) for the decision lifecycle graph.
 * Each agent writes its output under its own key; the reducer merges them.
 */
type AgentOutput = Record<string, unknown> | undefined;

const lastValueReducer = (
  _prev: AgentOutput,
  next: AgentOutput,
): AgentOutput => next;

const lastStringReducer = (
  _prev: string | undefined,
  next: string | undefined,
): string | undefined => next;

export const DecisionState = Annotation.Root({
  'user-goals': Annotation<AgentOutput>({
    reducer: lastValueReducer,
  }),
  'risk-assessment': Annotation<AgentOutput>({
    reducer: lastValueReducer,
  }),
  'market-research': Annotation<AgentOutput>({
    reducer: lastValueReducer,
  }),
  'portfolio-construction': Annotation<AgentOutput>({
    reducer: lastValueReducer,
  }),
  'rebalance-planner': Annotation<AgentOutput>({
    reducer: lastValueReducer,
  }),
  'explainability': Annotation<AgentOutput>({
    reducer: lastValueReducer,
  }),
  input: Annotation<string | undefined>({
    reducer: lastStringReducer,
  }),
});

export type DecisionStateType = typeof DecisionState.State;

/**
 * A map of agent type to its node function, allowing callers to inject
 * custom or mocked node functions.
 */
export type AgentNodeMap = Record<AgentType, AgentNodeFn>;

/**
 * A compiled graph that can be invoked with a partial DecisionStateType.
 * We use a simplified interface to avoid LangGraph's excessively deep
 * generic type instantiation.
 */
export interface CompiledDecisionGraph {
  invoke(input: Partial<DecisionStateType>): Promise<DecisionStateType>;
}

// Internal helper: fans out to wave nodes by running them in parallel
function createWaveNode(
  agents: AgentType[],
  nodeMap: AgentNodeMap,
): (state: DecisionStateType) => Promise<Partial<DecisionStateType>> {
  return async (state: DecisionStateType): Promise<Partial<DecisionStateType>> => {
    const results = await Promise.all(
      agents.map((agentType) => nodeMap[agentType](state as Record<string, unknown>)),
    );
    return Object.assign({}, ...results) as Partial<DecisionStateType>;
  };
}

/**
 * Builds the decision lifecycle graph.
 *
 * Wave 1 (parallel): user-goals, risk-assessment, market-research
 * Wave 2 (parallel, depends on wave 1): portfolio-construction, rebalance-planner
 * Wave 3 (serial, depends on wave 2): explainability
 *
 * @param nodeMap - Map of agent type to node function (use createAgentNode or mocks)
 * @returns A compiled LangGraph state graph ready for invocation
 */
export function buildDecisionGraph(
  nodeMap: AgentNodeMap,
): CompiledDecisionGraph {
  const wave1 = createWaveNode(
    ['user-goals', 'risk-assessment', 'market-research'],
    nodeMap,
  );
  const wave2 = createWaveNode(
    ['portfolio-construction', 'rebalance-planner'],
    nodeMap,
  );
  const wave3Node = async (
    state: DecisionStateType,
  ): Promise<Partial<DecisionStateType>> => {
    return nodeMap['explainability'](state as Record<string, unknown>);
  };

  const graph = new StateGraph(DecisionState)
    .addNode('wave1', wave1)
    .addNode('wave2', wave2)
    .addNode('wave3', wave3Node)
    .addEdge('__start__', 'wave1')
    .addEdge('wave1', 'wave2')
    .addEdge('wave2', 'wave3')
    .addEdge('wave3', '__end__');

  // Use type assertion to work around LangGraph's excessively deep
  // generic type instantiation (TS2589)
  return graph.compile() as unknown as CompiledDecisionGraph;
}
