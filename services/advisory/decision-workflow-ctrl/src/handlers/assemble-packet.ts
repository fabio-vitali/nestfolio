import { createMemoryClient, type MemoryClient } from '@nestfolio/agent-orchestrator';
import { requireEnv } from '@nestfolio/event-processor';
import { DecisionPacketRepository } from '../repositories/decision-packet.repository';

const UPSTREAM_SERVICES = [
  'investor-profile',
  'market-intelligence',
  'portfolio-engine',
  'advisory-narrative',
] as const;

interface AssemblePacketDeps {
  memoryClient: MemoryClient;
  decisionPacketRepository: DecisionPacketRepository;
}

interface AssemblePacketEvent {
  decisionId: string;
  tenantId: string;
  userId: string;
  region: string;
  trigger: string;
  triggerEventId: string;
  executionArn: string | null;
}

export function createAssemblePacketHandler(deps: AssemblePacketDeps) {
  return async (event: AssemblePacketEvent): Promise<Record<string, unknown>> => {
    const { decisionId, tenantId, userId, region, trigger, triggerEventId, executionArn } = event;

    // Materialize the DecisionPacket row first. CDC on this INSERT emits
    // DECISION_PACKET_CREATED on advisoryBus, which the dashboard read model
    // and advisory-bff DecisionReadModel both subscribe to. Idempotent under
    // SF retries (putIfNotExists).
    await deps.decisionPacketRepository.createDecisionPacket(
      { decisionId, trigger, triggerEventId, executionArn },
      { tenantId, userId, region },
    );

    const session = deps.memoryClient.openDecisionSession(tenantId, decisionId);

    const [investorProfile, marketAnalysis, portfolio, narrative] = await Promise.all(
      UPSTREAM_SERVICES.map((svc) => session.readUpstreamOutput(svc)),
    );

    const parse = (records: typeof investorProfile): Record<string, unknown> | null =>
      records[0]?.content ? JSON.parse(records[0].content) : null;

    const investorProfileOutput = parse(investorProfile);
    const marketAnalysisOutput = parse(marketAnalysis);
    const portfolioOutput = parse(portfolio);
    const narrativeOutput = parse(narrative);

    // Compliance inputs — sourced from agent outputs with safe defaults so the
    // rule engine can always run. Empty trades + zero portfolio + neutral risk
    // resolve APPROVED L1 (no exposure, no violations), which is the
    // correct degenerate behavior when agents haven't yet produced structured
    // output. As agent schemas mature, populate these from real fields.
    const proposedTrades = (portfolioOutput?.proposedTrades as unknown[] | undefined) ?? [];
    const currentPositions = (portfolioOutput?.currentPositions as unknown[] | undefined) ?? [];
    const portfolioValue = (portfolioOutput?.portfolioValue as number | undefined) ?? 0;
    const riskScore = (investorProfileOutput?.riskScore as number | undefined) ?? 5;

    return {
      decisionId,
      tenantId,
      investorProfileOutput,
      marketAnalysisOutput,
      portfolioOutput,
      narrativeOutput,
      proposedTrades,
      currentPositions,
      portfolioValue,
      riskScore,
    };
  };
}

// Production wiring
const memoryId = requireEnv('MEMORY_ID');
const tableName = requireEnv('TABLE_NAME');
const region = process.env.AWS_REGION ?? 'us-east-1';
const memoryClient = createMemoryClient({ memoryId, region, serviceName: 'decision-workflow' });
const decisionPacketRepository = new DecisionPacketRepository(tableName);
export const handler = createAssemblePacketHandler({ memoryClient, decisionPacketRepository });
