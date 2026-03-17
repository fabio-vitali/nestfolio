import { z } from 'zod';

export const RiskAssessmentSchema = z.object({
  riskScore: z
    .number()
    .min(0)
    .max(100)
    .describe('Numerical risk score from 0 (very conservative) to 100 (very aggressive)'),
  riskCategory: z
    .enum(['conservative', 'moderate', 'balanced', 'growth', 'aggressive'])
    .describe('Categorical risk classification'),
  maxDrawdown: z
    .number()
    .min(0)
    .max(1)
    .describe('Maximum acceptable portfolio drawdown as a decimal'),
  volatilityBudget: z
    .number()
    .min(0)
    .max(1)
    .describe('Annualised volatility budget as a decimal'),
  concentrationLimits: z
    .record(z.string(), z.number().min(0).max(1))
    .describe('Maximum allocation per asset class or sector'),
  rationale: z.string().min(1).describe('Explanation of the risk assessment'),
});

export type RiskAssessment = z.infer<typeof RiskAssessmentSchema>;
