import { z } from 'zod';

const TradeSchema = z.object({
  ticker: z.string().min(1).describe('Asset ticker symbol'),
  action: z.enum(['buy', 'sell']).describe('Trade direction'),
  quantity: z.number().positive().describe('Number of units to trade'),
  urgency: z
    .enum(['immediate', 'next-session', 'within-week', 'opportunistic'])
    .describe('Execution urgency'),
});

export const RebalancePlanSchema = z.object({
  trades: z.array(TradeSchema).describe('Ordered list of trades to execute'),
  estimatedCost: z
    .number()
    .min(0)
    .describe('Estimated total transaction cost in basis points'),
  rebalanceReason: z
    .string()
    .min(1)
    .describe('High-level reason for the rebalance'),
});

export type RebalancePlan = z.infer<typeof RebalancePlanSchema>;
