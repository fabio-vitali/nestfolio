import { END, StateGraph } from '@langchain/langgraph';
import { ChatBedrockConverse } from '@langchain/aws';
import { OnboardingAnnotation, PHASE_ORDER } from '../../src/agent/state';
import { routeToPhase } from '../../src/agent/router';
import { afterPhase, createPhaseNode } from '../../src/agent/phase-node';
import { RENDER_TOOLS } from '../../src/agent/tools/render-ui';
import type { OnboardingRepository } from '../../src/repositories/onboarding.repository';
import { createCommitPhaseTool } from '../../src/agent/tools/commit-phase';
import { computeRiskProfile } from '../../src/agent/tools/compute-risk';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
} from '@aws-sdk/client-bedrock-agent-runtime';

interface GraphDeps {
  modelId?: string;
  region?: string;
  repo: OnboardingRepository;
}

const ONBOARDING_OVERRIDE_MAP: Record<string, string> = {
  haiku: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  sonnet: 'us.anthropic.claude-sonnet-4-6',
  opus: 'us.anthropic.claude-opus-4-6-v1',
};

const ONBOARDING_RECURSION_LIMIT = 10;
const ONBOARDING_MAX_TOKENS = 2048;

export function buildOnboardingGraph(deps: GraphDeps) {
  const overrideTier = process.env['AGENT_MODEL_OVERRIDE'];
  const overrideId = overrideTier ? ONBOARDING_OVERRIDE_MAP[overrideTier] : undefined;
  const model = new ChatBedrockConverse({
    // Bedrock requires inference profile IDs (the `us.` prefix) for Claude
    // Sonnet 4.x in us-east-1; passing a base model id returns
    // `ValidationException` with no message body. The default below mirrors
    // the explicit `modelId` strings used by the advisory AgentConfigs in
    // services/advisory/*/src/agents/*.config.ts.
    model: overrideId ?? deps.modelId ?? 'us.anthropic.claude-sonnet-4-6',
    region: deps.region ?? 'us-east-1',
    maxTokens: ONBOARDING_MAX_TOKENS,
    temperature: 0,
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

  const renderTools = RENDER_TOOLS.map((t) => new DynamicStructuredTool({
    name: t.name,
    description: t.description,
    schema: t.schema as any,
    func: async (input) => JSON.stringify(input),
  }));

  const kbClient = new BedrockAgentRuntimeClient({ region: deps.region ?? 'us-east-1' });
  const knowledgeBaseId = process.env['KNOWLEDGE_BASE_ID'] ?? '';
  const searchKbTool = new DynamicStructuredTool({
    name: 'search_knowledge_base',
    description:
      'Search the Nestfolio product knowledge base for an answer to a user question (e.g. about how rebalancing, the platform, fees, or any product feature works). Use whenever the user asks an informational question rather than answering the current onboarding phase question.',
    schema: z.object({
      query: z.string().describe('The user\'s question, in their own words.'),
    }),
    func: async ({ query }) => {
      if (!knowledgeBaseId) return 'Knowledge base non configurata.';
      try {
        const response = await kbClient.send(
          new RetrieveCommand({
            knowledgeBaseId,
            retrievalQuery: { text: query },
            retrievalConfiguration: { vectorSearchConfiguration: { numberOfResults: 5 } },
          }),
        );
        const chunks = (response.retrievalResults ?? [])
          .map((r) => r.content?.text ?? '')
          .filter(Boolean);
        return chunks.length ? chunks.join('\n\n---\n\n') : 'Nessun risultato trovato nella documentazione.';
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('search_knowledge_base failed', { error: (err as Error).message });
        return 'Errore durante la ricerca nella documentazione.';
      }
    },
  });

  const allTools = [...renderTools, commitPhaseTool, computeRiskTool, searchKbTool];
  const toolsByName: Record<string, any> = {};
  for (const t of allTools) {
    toolsByName[t.name] = t;
  }

  const nodeDeps = { model, tools: allTools, toolsByName };

  const graph = new StateGraph(OnboardingAnnotation);

  graph.addNode('router', async (state) => state);

  for (const phase of PHASE_ORDER) {
    graph.addNode(`${phase}_node`, createPhaseNode(phase, nodeDeps));
  }

  graph.addNode('safety_cap_node', async (state) => {
    const { messages } = state;
    const wrapUpMsg = new (await import('@langchain/core/messages')).SystemMessage(
      'SAFETY CAP: L\'utente ha raggiunto il limite di 50 turni. Salva tutti i dati raccolti finora, mostra un riepilogo e presenta un pulsante "Riprendi piu tardi". NON continuare con nuove fasi.'
    );
    const response = await nodeDeps.model.bindTools(allTools as any[]).invoke([wrapUpMsg, ...messages as any[]]);
    return { messages: [response] };
  });

  // Build the routing map dynamically so PHASE_ORDER is the single source of truth.
  const phaseRouteMap: Record<string, string> = {
    safety_cap_node: 'safety_cap_node',
    __end__: '__end__',
  };
  for (const phase of PHASE_ORDER) {
    phaseRouteMap[`${phase}_node`] = `${phase}_node`;
  }

  graph.addEdge('__start__', 'router');
  graph.addConditionalEdges('router', routeToPhase, phaseRouteMap as any);
  graph.addEdge('safety_cap_node', '__end__');

  // Each phase node either:
  //   - committed and advanced state.phase → loop back through router so the
  //     same browser turn renders the NEXT phase's UI
  //   - emitted a render_X tool → end so the browser can mount the renderer
  for (const phase of PHASE_ORDER) {
    graph.addConditionalEdges(`${phase}_node`, afterPhase(phase), {
      router: 'router',
      [END]: END,
    } as any);
  }

  // Tracer (if any) is wired by the caller via streamEvents config.callbacks
  // (see agents/onboarding/server.ts). withConfig wrapping doesn't propagate
  // BaseCallbackHandler hooks down to nested tool.invoke calls in this version
  // of LangGraph + ChatBedrockConverse. Recursion cap is the only baseline we
  // bake in here — it bounds runaway router→phase loops.
  return graph.compile().withConfig({ recursionLimit: ONBOARDING_RECURSION_LIMIT });
}
