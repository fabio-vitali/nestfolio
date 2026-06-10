// Producer-owned contracts for portfolio-engine-ctrl. Imports zod + the service's agent schemas.
// PortfolioAgentOutput is the COMPOSITE runPipeline return stored as AgentCompletion.agentOutput
// and CDC-emitted on PORTFOLIO_COMPLETED — NOT a bare PortfolioConstructionSchema instance.
//
// Shape verified against agent-service.ts runPipeline return (lines 146-151):
//   { decisionId, allocations, trades, metadata: { durationMs, modelTiers: string[], modeUsed } }
// `trades` is always produced in the real implementation (rebalance-planner is a required expected key),
// but kept optional here for safe additive tolerance.
// `modelTiers` is a string[] in reality (['opus', 'sonnet']), not a Record — modelled accordingly.
import { z } from 'zod';
import { PortfolioConstructionSchema, RebalancePlanSchema } from '../agents/schemas';

export const PortfolioAgentOutputSchema = z.object({
  decisionId: z.string(),
  allocations: PortfolioConstructionSchema,
  trades: RebalancePlanSchema.optional(),
  metadata: z.object({
    durationMs: z.number(),
    modelTiers: z.array(z.string()).optional(),
    modeUsed: z.string().optional(),
  }).passthrough(),
});
export type PortfolioAgentOutput = z.infer<typeof PortfolioAgentOutputSchema>;
