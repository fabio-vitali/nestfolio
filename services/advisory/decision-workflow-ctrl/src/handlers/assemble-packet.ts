import { requireEnv } from '@nestfolio/event-processor';
import type { InvestorProfileSnapshot } from '@nestfolio/investor-profile-ctrl/contracts';
import type { MarketSnapshot } from '@nestfolio/market-intelligence-ctrl/contracts';
import type { PortfolioAgentOutput } from '@nestfolio/portfolio-engine-ctrl/contracts';
import type { NarrativeAgentOutput } from '@nestfolio/advisory-narrative-ctrl/contracts';
import { DecisionPacketRepository } from '../repositories/decision-packet.repository';
import { MICRO_TRADE_EPSILON_BPS } from '../trade-thresholds';

interface AssemblePacketDeps {
  decisionPacketRepository: DecisionPacketRepository;
}

interface LedgerSnapshotState {
  positions?: Record<string, { quantity?: number; lastFillPrice?: number }>;
  cashBalanceCents?: number;
}

interface AssemblePacketEvent {
  decisionId: string;
  tenantId: string;
  userId: string;
  region: string;
  trigger: string;
  triggerEventId: string;
  executionArn: string | null;
  /** Cents from the trigger event (e.g. DEPOSIT_DETECTED.amountCents).
   *  May be undefined for non-deposit triggers. */
  triggerAmountCents?: number;
  // Agent outputs plumbed via SF state Parameters from $.agentResults.<Upstream>.agentOutput
  // (see services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts
  // AssembleDecisionPacket Parameters.Payload). Each is typed as Partial<ProducerSchema>:
  // the full structured agentOutput (the common runtime case, from States.StringToJson) AND
  // the degraded `{}` / partial cases both conform, while every field the handler reads stays
  // typed. No `| Record<string,unknown>` erasure — the producer contracts are the contract.
  //
  // investorProfile/marketAnalysis are the agentOutput SUB-object (hence ['agentOutput']);
  // portfolio/narrative are the full composite output.
  investorProfile?: Partial<InvestorProfileSnapshot['agentOutput']> | null;
  marketAnalysis?: Partial<MarketSnapshot['agentOutput']> | null;
  portfolio?: Partial<PortfolioAgentOutput> | null;
  narrative?: Partial<NarrativeAgentOutput> | null;
  // Plumbed by the SF (Branch C of ParallelProjections); SF substitutes a default on absent-row.
  ledgerSnapshot?: LedgerSnapshotState;
}

interface Allocation {
  instrument: string;
  assetClass: string;
  targetWeight: number;
  rationale: string;
}

interface CurrentPosition {
  symbol: string;
  quantity: number;
  marketValueCents: number;
}

function indexTargets(allocations: ReadonlyArray<Partial<Allocation>>): Map<string, Allocation> {
  const out = new Map<string, Allocation>();
  for (const a of allocations) {
    if (!a.instrument || a.assetClass === 'CASH') continue;
    const symbol = a.instrument.trim().toUpperCase();
    if (!symbol) continue;
    out.set(symbol, {
      instrument: symbol,
      assetClass: (a.assetClass as string) ?? 'OTHER',
      targetWeight: (a.targetWeight as number) ?? 0,
      rationale: (a.rationale as string) ?? '',
    });
  }
  return out;
}

function indexCurrent(currentPositions: ReadonlyArray<CurrentPosition>): Map<string, CurrentPosition> {
  const out = new Map<string, CurrentPosition>();
  for (const p of currentPositions) out.set(p.symbol, p);
  return out;
}

export const __INTERNAL__ = { indexTargets, indexCurrent };

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
      triggerAmountCents,
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

    // Portfolio output schema: portfolio-engine-ctrl's agent-service.ts returns
    // { decisionId, allocations, trades, metadata } at the top level. We read
    // portfolio.allocations.{allocations} — NOT portfolio['portfolio-construction'].
    // totalExposure (≈1.0) is the agent's normalization indicator and is NOT a
    // portfolio value; we derive portfolioValueCents from triggerAmountCents
    // + currentPositionsValueCents instead.
    const allocationsArray = portfolio?.allocations?.allocations ?? [];

    // LedgerSnapshot is plumbed in by the SF (Branch C of ParallelProjections).
    // On absent-row, the SF substitutes { positions: {}, cashBalanceCents: 0 } —
    // so we never have to handle `undefined` here.
    const ledgerSnapshot = event.ledgerSnapshot ?? { positions: {}, cashBalanceCents: 0 };

    const positionsBySymbol = ledgerSnapshot.positions ?? {};
    const cashBalanceCents = ledgerSnapshot.cashBalanceCents ?? 0;

    const currentPositions = Object.entries(positionsBySymbol)
      .filter(([, p]) => (p?.quantity ?? 0) > 0)
      .map(([symbol, p]) => ({
        symbol: symbol.trim().toUpperCase(),
        quantity: p.quantity!,
        marketValueCents: Math.round((p.quantity ?? 0) * (p.lastFillPrice ?? 0) * 100),
      }));

    const currentPositionsValueCents = currentPositions.reduce(
      (sum, p) => sum + p.marketValueCents,
      0,
    );
    const portfolioValueCents =
      currentPositionsValueCents + cashBalanceCents + (triggerAmountCents ?? 0);

    // Map allocations → ProposedTrade shape per advisory-bff schema
    // (services/advisory/advisory-bff/src/schema.graphql, ProposedTrade type).
    // Delta-based: quantityOrAmountCents = |targetCents - currentCents|.
    // side = BUY when target > current, SELL when target < current.
    // Held symbols not in target → full SELL.
    // Initial-build path (currentPositions=[]) degenerates correctly:
    //   delta = targetCents - 0 = targetCents → BUY targetCents.
    const targets = indexTargets(allocationsArray as ReadonlyArray<Partial<Allocation>>);
    const current = indexCurrent(currentPositions);

    interface TradeCandidate {
      symbol: string;
      assetClass: string;
      side: 'BUY' | 'SELL';
      quantityOrAmountCents: number;
      targetWeightPercent: number;
      rationale: string;
    }

    const candidates: TradeCandidate[] = [];

    // Pass 1: every target symbol.
    for (const [symbol, target] of targets) {
      const targetCents = Math.round(target.targetWeight * portfolioValueCents);
      const currentCents = current.get(symbol)?.marketValueCents ?? 0;
      const delta = targetCents - currentCents;
      if (delta === 0) continue;
      candidates.push({
        symbol,
        assetClass: target.assetClass,
        side: delta > 0 ? 'BUY' : 'SELL',
        quantityOrAmountCents: Math.abs(delta),
        targetWeightPercent: target.targetWeight * 100,
        rationale: target.rationale,
      });
    }

    // Pass 2: held symbols not in target → full SELL.
    for (const [symbol, pos] of current) {
      if (targets.has(symbol)) continue;
      candidates.push({
        symbol,
        assetClass: 'OTHER',
        side: 'SELL',
        quantityOrAmountCents: pos.marketValueCents,
        targetWeightPercent: 0,
        rationale: 'Liquidating position no longer in target allocation.',
      });
    }

    const epsilonCents = Math.round(
      (portfolioValueCents * MICRO_TRADE_EPSILON_BPS) / 10_000,
    );
    const sideRank = (side: 'BUY' | 'SELL') => (side === 'SELL' ? 0 : 1);
    const proposedTrades = candidates
      .filter((t) => t.quantityOrAmountCents >= epsilonCents)
      .sort((a, b) => sideRank(a.side) - sideRank(b.side) || a.symbol.localeCompare(b.symbol));

    const isInitialBuild = currentPositions.length === 0;
    const riskCategory = investorProfile?.riskCategory ?? 'MODERATE';

    // Narrative output shape: advisory-narrative-ctrl's agent-service.ts spreads
    // `explainability` at the top level (`return { decisionId, ...explainability, metadata }`),
    // so SF state carries narrative.rationale + narrative.summary directly — no
    // `.explainability.` nesting. `rationale` first, fall back to `summary`.
    // Final placeholder is defence-in-depth for the degraded-output path.
    const explanation =
      narrative?.rationale ??
      narrative?.summary ??
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
      portfolioValueCents,
      isInitialBuild,
      riskCategory,
    };
  };
}

// Production wiring
const tableName = requireEnv('TABLE_NAME');
const decisionPacketRepository = new DecisionPacketRepository(tableName);
export const handler = createAssemblePacketHandler({ decisionPacketRepository });
