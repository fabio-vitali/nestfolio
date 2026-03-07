import { z } from 'zod';

const AllocationSchema = z.object({
  ticker: z.string().min(1).describe('Asset ticker symbol'),
  weight: z
    .number()
    .min(0)
    .max(1)
    .describe('Target portfolio weight as a decimal'),
  rationale: z.string().min(1).describe('Reason for this allocation'),
});

export const PortfolioConstructionSchema = z.object({
  allocations: z
    .array(AllocationSchema)
    .min(1)
    .describe('Target portfolio allocations'),
  expectedReturn: z
    .number()
    .describe('Expected annualised portfolio return as a decimal'),
  expectedVolatility: z
    .number()
    .min(0)
    .describe('Expected annualised portfolio volatility as a decimal'),
  sharpeRatio: z.number().describe('Expected Sharpe ratio of the portfolio'),
});

export type PortfolioConstruction = z.infer<typeof PortfolioConstructionSchema>;
