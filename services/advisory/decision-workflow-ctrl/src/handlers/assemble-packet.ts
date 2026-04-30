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

    // The narrative agent's ExplainabilitySchema produces `rationale` (detailed
    // reasoning) and `summary` (short framing). Map to the read model's
    // `explanation` field — `rationale` first, fall back to `summary`. The
    // final placeholder is defence-in-depth for the rare case where the upstream
    // Memory read returns no record (e.g. transient AgentCore unavailability or
    // an agent that ran but failed to persist its output). With the Memory client
    // contract aligned (Spec 2 — direct record write + list-records read against
    // the same /agent/{tenant}/decisions/{decisionId} namespace), this read
    // returns the agent's structured output as the primary path.
    const explanation =
      (narrativeOutput?.rationale as string | undefined) ??
      (narrativeOutput?.summary as string | undefined) ??
      `Decision pending — the advisory narrative for this ${trigger} trigger has not been persisted yet.`;

    // Materialize the DecisionPacket row with the synthesized content. CDC on
    // this INSERT emits DECISION_PACKET_CREATED on advisoryBus, which the
    // dashboard read model and advisory-bff DecisionReadModel both subscribe
    // to. Carrying explanation + proposedTrades on the initial insert is what
    // populates DecisionReadModel's content fields — the row is never updated
    // with these afterwards. Idempotent under SF retries (putIfNotExists).
    await deps.decisionPacketRepository.createDecisionPacket(
      {
        decisionId,
        trigger,
        triggerEventId,
        executionArn,
        explanation,
        proposedTrades,
        confirmationRequired: true,
      },
      { tenantId, userId, region },
    );

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
