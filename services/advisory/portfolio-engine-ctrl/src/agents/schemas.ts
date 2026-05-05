import { z } from 'zod';

export const PortfolioConstructionSchema = z.object({
  allocations: z.array(z.object({
    instrument: z.string(),
    // assetClass added in Phase 2 of operating-mode workstream so the
    // decision-workflow-ctrl assembler can derive equity vs fixed-income
    // weights when mapping allocations → ProposedTrade. The agent MUST
    // classify each instrument; without it, mode-envelope assertions in the
    // e2e gate cannot verify mode adherence.
    assetClass: z.enum(['EQUITY', 'FIXED_INCOME', 'REIT', 'COMMODITY', 'CASH', 'CRYPTO', 'OTHER']),
    targetWeight: z.number().min(0).max(1),
    rationale: z.string(),
  })),
  totalExposure: z.number(),
  // equityWeight + largestPositionWeight added in Phase 2 of operating-mode workstream
  // (docs/superpowers/specs/2026-05-05-operating-mode-phase-2-design.md). The agent
  // MUST report these so e2e gates can assert mode-envelope adherence
  // (CONSERVATIVE ≤ 0.30 equity / ≤ 0.10 single-position, etc.).
  equityWeight: z.number().min(0).max(1).describe('Total weight in equity instruments (vs fixed income / cash)'),
  riskMetrics: z.object({
    concentrationRisk: z.number(),
    sectorDiversity: z.number(),
    largestPositionWeight: z.number().min(0).max(1).describe('Weight of the single largest position'),
  }),
  confidence: z.number().min(0).max(1),
});

export const RebalancePlanSchema = z.object({
  trades: z.array(z.object({
    action: z.enum(['BUY', 'SELL', 'REBALANCE']),
    instrument: z.string(),
    targetWeight: z.number(),
    currentWeight: z.number(),
    quantity: z.number().nullable(),
    rationale: z.string(),
  })),
  estimatedTurnover: z.number(),
  confidence: z.number().min(0).max(1),
});
