import { z } from 'zod';

export const GoalInterpretationSchema = z.object({
  goalId: z.string().min(1).describe('Unique identifier for this goal interpretation'),
  interpretedObjective: z
    .string()
    .min(1)
    .describe('Natural-language interpretation of the user investment objective'),
  timeHorizonMonths: z
    .number()
    .int()
    .positive()
    .describe('Investment time horizon in months'),
  targetReturn: z
    .number()
    .min(0)
    .max(1)
    .describe('Annualised target return as a decimal (e.g. 0.08 for 8%)'),
  riskBudget: z
    .number()
    .min(0)
    .max(1)
    .describe('Maximum acceptable annualised volatility as a decimal'),
  constraints: z
    .array(z.string())
    .describe('List of constraints derived from user preferences'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('Agent confidence in its interpretation (0-1)'),
});

export type GoalInterpretation = z.infer<typeof GoalInterpretationSchema>;
