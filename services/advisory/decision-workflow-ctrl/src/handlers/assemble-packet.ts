import { requireEnv } from '@nestfolio/event-processor';
import { DecisionPacketRepository } from '../repositories/decision-packet.repository';

interface AssemblePacketDeps {
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
  // Agent outputs plumbed via SF state Parameters from $.agentResults.<Upstream>.agentOutput
  // (see services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts
  // AssembleDecisionPacket Parameters.Payload). Any may be null/undefined when the
  // upstream agent failed to produce structured output — the placeholder fallbacks
  // below keep the decision packet creatable in degraded states.
  investorProfile?: Record<string, unknown> | null;
  marketAnalysis?: Record<string, unknown> | null;
  portfolio?: Record<string, unknown> | null;
  narrative?: Record<string, unknown> | null;
}

export function createAssemblePacketHandler(deps: AssemblePacketDeps) {
  return async (event: AssemblePacketEvent): Promise<Record<string, unknown>> => {
    const {
      decisionId,
      tenantId,
      userId,
      region,
      trigger,
      triggerEventId,
      executionArn,
      investorProfile = null,
      marketAnalysis = null,
      portfolio = null,
      narrative = null,
    } = event;

    // Single-writer SF-state contract (post-Phase-A 2026-05-14): agent outputs
    // arrive via SF state Parameters from $.agentResults.<Upstream>.agentOutput.
    // No Memory reads, no retry loop, no eventual-consistency window. The
    // placeholder fallbacks below are defence-in-depth for cases where an
    // upstream agent failed to produce structured output (DegradedAgentOutputError
    // path) — they keep the decision packet creatable in degraded states.

    // Portfolio output schema (post-Phase-A, 2026-05-14): portfolio-engine-ctrl's
    // agent-service.ts returns { decisionId, allocations, trades, metadata }
    // at the top level. The LangGraph node-keyed outputs (portfolio-construction /
    // rebalance-planner) are renamed by the agent-service layer; the SF plumbs
    // that return value through as `portfolio` here, so we read
    // portfolio.allocations.{allocations,totalExposure,…} — NOT portfolio['portfolio-construction'].
    const allocationEnvelope = (portfolio?.allocations as Record<string, unknown> | undefined) ?? {};
    const allocationsArray = (allocationEnvelope.allocations as Array<Record<string, unknown>> | undefined) ?? [];
    const portfolioValue = (allocationEnvelope.totalExposure as number | undefined) ?? 0;

    // Map allocations → ProposedTrade shape per advisory-bff schema
    // (services/advisory/advisory-bff/src/schema.graphql, ProposedTrade type). Phase 2 of the
    // operating-mode workstream made `assetClass` mandatory on the agent's schema
    // so the equityWeight derivation downstream is deterministic.
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
    const currentPositions = (portfolio?.currentPositions as unknown[] | undefined) ?? [];
    const riskScore = (investorProfile?.riskScore as number | undefined) ?? 5;

    // Narrative output schema: agent's writeAgentOutput previously persisted
    // {explainability: shaped['explainability'].output} — the same shape now
    // arrives directly through SF state. See narrative graph.ts.
    // `rationale` first, fall back to `summary`. Final placeholder is
    // defence-in-depth for the degraded-output path.
    const explainability = (narrative?.explainability as Record<string, unknown> | undefined) ?? {};
    const explanation =
      (explainability.rationale as string | undefined) ??
      (explainability.summary as string | undefined) ??
      `Decision pending — the advisory narrative for this ${trigger} trigger has not been persisted yet.`;

    // Materialize the DecisionPacket row. CDC on this INSERT emits
    // DECISION_PACKET_CREATED on advisoryBus, which the dashboard read model
    // and advisory-bff DecisionReadModel both subscribe to. Idempotent under
    // SF retries (putIfNotExists).
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
      investorProfileOutput: investorProfile,
      marketAnalysisOutput: marketAnalysis,
      portfolioOutput: portfolio,
      narrativeOutput: narrative,
      proposedTrades,
      currentPositions,
      portfolioValue,
      riskScore,
    };
  };
}

// Production wiring
const tableName = requireEnv('TABLE_NAME');
const decisionPacketRepository = new DecisionPacketRepository(tableName);
export const handler = createAssemblePacketHandler({ decisionPacketRepository });
