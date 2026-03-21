import { createMemoryClient, type MemoryClient } from '@nestfolio/agent-orchestrator';
import { requireEnv } from '@nestfolio/event-processor';

const UPSTREAM_SERVICES = [
  'investor-profile',
  'market-intelligence',
  'portfolio-engine',
  'advisory-narrative',
] as const;

interface AssemblePacketDeps {
  memoryClient: MemoryClient;
}

export function createAssemblePacketHandler(deps: AssemblePacketDeps) {
  return async (event: { decisionId: string; tenantId: string }): Promise<Record<string, unknown>> => {
    const { decisionId, tenantId } = event;
    const session = deps.memoryClient.openDecisionSession(tenantId, decisionId);

    const [investorProfile, marketAnalysis, portfolio, narrative] = await Promise.all(
      UPSTREAM_SERVICES.map((svc) => session.readUpstreamOutput(svc)),
    );

    const parse = (records: typeof investorProfile) =>
      records[0]?.content ? JSON.parse(records[0].content) : null;

    return {
      decisionId,
      tenantId,
      investorProfileOutput: parse(investorProfile),
      marketAnalysisOutput: parse(marketAnalysis),
      portfolioOutput: parse(portfolio),
      narrativeOutput: parse(narrative),
    };
  };
}

// Production wiring
const memoryId = requireEnv('MEMORY_ID');
const region = process.env.AWS_REGION ?? 'us-east-1';
const memoryClient = createMemoryClient({ memoryId, region, serviceName: 'decision-workflow' });
export const handler = createAssemblePacketHandler({ memoryClient });
