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

    const [investorProfile, marketAnalysis, portfolioInitial, narrative] = await Promise.all(
      UPSTREAM_SERVICES.map((svc) => session.readUpstreamOutput(svc)),
    );

    // AgentCore Memory ListMemoryRecords has >40s eventual-consistency window
    // for fresh BatchCreateMemoryRecords writes. The `portfolio-engine` write
    // is the most recent in the chain (just emitted by InvokePortfolioEngine →
    // InvokeAdvisoryNarrative completes shortly before AssemblePacket runs).
    // Retry on the portfolio record specifically — it drives proposedTrades.
    // Tests short-circuit via MEMORY_READ_RETRY_DELAYS_MS_OVERRIDE.
    let portfolio = portfolioInitial;
    const retryDelays = (process.env.MEMORY_READ_RETRY_DELAYS_MS_OVERRIDE
      ?? '3000,5000,8000,12000')
      .split(',').map((s) => parseInt(s.trim(), 10));
    for (const delay of retryDelays) {
      if (portfolio[0]?.content) break;
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      portfolio = await session.readUpstreamOutput('portfolio-engine');
    }

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
    // output.
    //
    // Two writers land in the portfolio-engine namespace under the same
    // requestIdentifier — AgentCore Memory does not always dedupe within its
    // eventual-consistency window:
    //   1. AgentRuntime (graph.ts) writes the orchestrator's raw output
    //      keyed by node name: `{portfolio-construction:{allocations:[…]},
    //      rebalance-planner:{trades:[…]}}`.
    //   2. The Lambda's writeAgentOutput call writes the transformed runPipeline
    //      result: `{decisionId, allocations:{allocations:[…]}, trades:{…}}`.
    // Whichever record `[0]` returns is order-dependent. Extract from EITHER
    // shape so the read site is robust to the pre-existing dual-writer
    // (tracked separately — see project_advisory_pipeline_consolidation.md).
    // Phase 2 of the operating-mode workstream made `assetClass` mandatory on
    // the agent's schema so the equityWeight derivation downstream is
    // deterministic.
    const construction =
      (portfolioOutput?.allocations as Record<string, unknown> | undefined)
      ?? (portfolioOutput?.['portfolio-construction'] as Record<string, unknown> | undefined)
      ?? {};
    const allocationsArray = (construction.allocations as Array<Record<string, unknown>> | undefined) ?? [];
    const portfolioValue = (construction.totalExposure as number | undefined) ?? 0;
    const proposedTrades = allocationsArray.map((a) => {
      const targetWeight = (a.targetWeight as number | undefined) ?? 0;
      return {
        symbol: (a.instrument as string) ?? '',
        assetClass: (a.assetClass as string) ?? 'OTHER',
        side: 'BUY',
        quantityOrAmountCents: Math.round(targetWeight * portfolioValue * 100),
        targetWeightPercent: targetWeight * 100,
        rationale: (a.rationale as string) ?? '',
      };
    });
    const currentPositions = (portfolioOutput?.currentPositions as unknown[] | undefined) ?? [];
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
    // Same dual-writer fallback as portfolio above — narrativeOutput may be
    // either the Lambda's transformed shape (`{rationale,summary,...}` at
    // top level) or the AgentRuntime's raw shape
    // (`{explainability:{rationale,summary,...}}` keyed by node name).
    const narrativeContent =
      (narrativeOutput?.explainability as Record<string, unknown> | undefined)
      ?? narrativeOutput
      ?? {};
    const explanation =
      (narrativeContent.rationale as string | undefined) ??
      (narrativeContent.summary as string | undefined) ??
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
