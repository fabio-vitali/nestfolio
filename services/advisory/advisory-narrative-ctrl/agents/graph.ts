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
import { explainabilityConfig } from '../src/agents/explainability.config';
import { narrativeValidationRule } from '../src/agents/validation';
import { narrativeFallback } from '../src/agents/fallbacks';

const agentNode = withFallback(
  withRetry(
    withValidation(
      createAgentNode(explainabilityConfig),
      narrativeValidationRule,
    ),
    { maxAttempts: 2, escalationPath: ['sonnet', 'opus'] },
  ),
  narrativeFallback,
);

function buildKBClient(): KBClient | null {
  const kbId = process.env['KNOWLEDGE_BASE_ID'];
  if (!kbId) return null;
  return createKBClient({
    knowledgeBaseId: kbId,
    region: process.env['AWS_REGION'] ?? 'us-east-1',
  });
}

function buildMemoryClient(): MemoryClient {
  const memoryId = process.env['MEMORY_ID'];
  if (!memoryId) return createNoOpMemoryClient();
  return createMemoryClient({
    memoryId,
    region: process.env['AWS_REGION'] ?? 'us-east-1',
    serviceName: 'advisory-narrative-ctrl',
  });
}

export async function invokeNarrative(params: {
  tenantId: string;
  decisionId: string;
  input: string;
}): Promise<Record<string, unknown>> {
  const memory = buildMemoryClient();
  const session = memory.openDecisionSession(params.tenantId, params.decisionId);
  const kb = buildKBClient();

  // 1. Read upstream decision context from memory
  const upstreamRecords = await session.readUpstreamOutput('advisory-ctrl');
  const upstreamContext = upstreamRecords.length > 0
    ? `\n\nUpstream decision context:\n${upstreamRecords.map((r) => r.content).join('\n')}`
    : '';

  // 2. Retrieve relevant communication templates from KB
  let kbContext = '';
  if (kb) {
    const kbResults = await kb.retrieve(params.input, 3);
    if (kbResults.length > 0) {
      kbContext = `\n\nKnowledge base context:\n${kbResults.map((r) => r.text).join('\n')}`;
    }
  }

  // 3. Invoke agent with enriched input
  const enrichedInput = params.input + upstreamContext + kbContext;
  const result = await agentNode({ input: enrichedInput });

  // 4. Write output to memory
  await session.writeAgentOutput(result);

  return result;
}
