import { z } from 'zod';

export const PortfolioConstructionSchema = z.object({
  allocations: z.array(z.object({
    instrument: z.string(),
    targetWeight: z.number().min(0).max(1),
    rationale: z.string(),
  })),
  totalExposure: z.number(),
  riskMetrics: z.object({
    concentrationRisk: z.number(),
    sectorDiversity: z.number(),
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
