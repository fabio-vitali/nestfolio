import { StateGraph } from '@langchain/langgraph';
import { ChatBedrockConverse } from '@langchain/aws';
import { OnboardingAnnotation, PHASE_ORDER, MAX_TURNS } from './state';
import { routeToPhase } from './router';
import { createPhaseNode } from './phase-node';
import { RENDER_TOOLS } from './tools/render-ui';
import type { OnboardingRepository } from '../repositories/onboarding.repository';
import { createCommitPhaseTool } from './tools/commit-phase';
import { computeRiskProfile } from './tools/compute-risk';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

export interface GraphDeps {
  modelId?: string;
  region?: string;
  repo: OnboardingRepository;
}

export function buildOnboardingGraph(deps: GraphDeps) {
  const model = new ChatBedrockConverse({
    model: deps.modelId ?? 'anthropic.claude-sonnet-4-20250514',
    region: deps.region ?? 'us-east-1',
  });

  const commitPhaseTool = createCommitPhaseTool(deps.repo);

  const computeRiskTool = new DynamicStructuredTool({
    name: 'compute_risk_profile',
    description: 'Compute deterministic risk score from tolerance and experience indices (0-3)',
    schema: z.object({
      toleranceIdx: z.number().int().min(0).max(3),
      experienceIdx: z.number().int().min(0).max(3),
    }),
    func: async ({ toleranceIdx, experienceIdx }) => {
      const result = computeRiskProfile(toleranceIdx, experienceIdx);
      return JSON.stringify(result);
    },
  });

  const allTools = [...RENDER_TOOLS.map((t) => new DynamicStructuredTool({
    name: t.name,
    description: t.description,
    schema: t.schema as any,
    func: async (input) => JSON.stringify(input),
  })), commitPhaseTool, computeRiskTool];

  const nodeDeps = { model, tools: allTools };

  const graph = new StateGraph(OnboardingAnnotation);

  // Add router node
  graph.addNode('router', async (state) => state);

  // Add phase nodes
  for (const phase of PHASE_ORDER) {
    graph.addNode(`${phase}_node`, createPhaseNode(phase, nodeDeps));
  }

  // Safety cap node
  graph.addNode('safety_cap_node', async (state) => {
    const { messages } = state;
    const wrapUpMsg = new (await import('@langchain/core/messages')).SystemMessage(
      'SAFETY CAP: L\'utente ha raggiunto il limite di 50 turni. Salva tutti i dati raccolti finora, mostra un riepilogo e presenta un pulsante "Riprendi piu tardi". NON continuare con nuove fasi.'
    );
    const response = await nodeDeps.model.bindTools(allTools as any[]).invoke([wrapUpMsg, ...messages as any[]]);
    return { messages: [response] };
  });

  // Edges
  graph.addEdge('__start__', 'router');
  graph.addConditionalEdges('router', routeToPhase, {
    goal_node: 'goal_node',
    horizon_node: 'horizon_node',
    mode_node: 'mode_node',
    capital_node: 'capital_node',
    risk_node: 'risk_node',
    operating_mode_node: 'operating_mode_node',
    mandate_node: 'mandate_node',
    safety_cap_node: 'safety_cap_node',
    __end__: '__end__',
  });
  graph.addEdge('safety_cap_node', '__end__');

  // Each phase node loops back to router
  for (const phase of PHASE_ORDER) {
    graph.addEdge(`${phase}_node`, 'router');
  }

  return graph.compile();
}
