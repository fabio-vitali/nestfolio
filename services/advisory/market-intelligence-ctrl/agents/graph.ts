// services/advisory/market-intelligence-ctrl/agents/graph.ts
import {
  createAgentNode,
  withValidation,
  withRetry,
  withFallback,
  createKBClient,
  createMemoryClient,
  createNoOpMemoryClient,
  type KBClient,
  type MemoryClient,
} from '@nestfolio/agent-orchestrator';
import { marketResearchConfig } from '../src/agents/market-research.config';
import { marketResearchValidationRule } from '../src/agents/validation';
import { marketResearchFallback } from '../src/agents/fallbacks';

const agentNode = withFallback(
  withRetry(
    withValidation(createAgentNode(marketResearchConfig), marketResearchValidationRule),
    { maxAttempts: 3, escalationPath: ['sonnet'] },
  ),
  marketResearchFallback,
);

function buildKBClient(): KBClient | null {
  const kbId = process.env['KNOWLEDGE_BASE_ID'];
  if (!kbId) return null;
  return createKBClient({ knowledgeBaseId: kbId, region: process.env['AWS_REGION'] ?? 'us-east-1' });
}

function buildMemoryClient(): MemoryClient {
  const memoryId = process.env['MEMORY_ID'];
  if (!memoryId) return createNoOpMemoryClient();
  return createMemoryClient({
    memoryId,
    region: process.env['AWS_REGION'] ?? 'us-east-1',
    serviceName: 'market-intelligence-ctrl',
  });
}

export async function invokeMarketResearch(params: {
  tenantId: string;
  decisionId: string;
  input: string;
}): Promise<Record<string, unknown>> {
  const memory = buildMemoryClient();
  const session = memory.openDecisionSession(params.tenantId, params.decisionId);
  const kb = buildKBClient();

  // 1. Retrieve market intelligence from KB (news, sentiment, macro)
  let kbContext = '';
  if (kb) {
    const kbResults = await kb.retrieve(params.input, 5);
    if (kbResults.length > 0) {
      kbContext = `\n\nMarket intelligence from knowledge base:\n${kbResults.map((r) => r.text).join('\n')}`;
    }
  }

  // 2. Read upstream context (investor profile from advisory-ctrl)
  const upstreamRecords = await session.readUpstreamOutput('advisory-ctrl');
  const upstreamContext = upstreamRecords.length > 0
    ? `\n\nUpstream context:\n${upstreamRecords.map((r) => r.content).join('\n')}`
    : '';

  // 3. Invoke agent
  const enrichedInput = params.input + kbContext + upstreamContext;
  const result = await agentNode({ input: enrichedInput });

  // 4. Persist to memory
  await session.writeAgentOutput(result);

  return result;
}
