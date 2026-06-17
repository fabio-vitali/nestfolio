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
import type { ZodTypeAny } from 'zod';
import { PortfolioConstructionSchema, RebalancePlanSchema } from '../agents/schemas';
import { AgentCompletionRowSchema, AgentFailureRowSchema } from '@nestfolio/agent-orchestrator';

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

/** PORTFOLIO_COMPLETED — the AgentCompletion row subject (agentOutput = PortfolioAgentOutput). */
export const PortfolioAgentCompletionSchema = AgentCompletionRowSchema('portfolio-engine', PortfolioAgentOutputSchema);
export type PortfolioAgentCompletion = z.infer<typeof PortfolioAgentCompletionSchema>;

/** PORTFOLIO_FAILED — the AgentFailure row subject. */
export const PortfolioAgentFailureSchema = AgentFailureRowSchema('portfolio-engine');
export type PortfolioAgentFailure = z.infer<typeof PortfolioAgentFailureSchema>;

/**
 * Test-fixture event→subject map for portfolio-engine-ctrl's emissions. Co-located with the
 * producer-owned schemas (single source of truth); consumed only by
 * `@nestfolio/test-contracts`. Bare string-literal keys so `keyof typeof` is a literal union.
 */
export const portfolioEngineCtrlEventSubjects = {
  PORTFOLIO_COMPLETED: PortfolioAgentCompletionSchema,
  PORTFOLIO_FAILED: PortfolioAgentFailureSchema,
} as const satisfies Record<string, ZodTypeAny>;
