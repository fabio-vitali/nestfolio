import { z } from 'zod';

export const ExplainabilitySchema = z.object({
  summary: z.string().describe('Clear, personalized summary of the decision'),
  rationale: z.string().describe('Detailed reasoning behind the recommendation'),
  keyFactors: z.array(z.string()).describe('Key factors that influenced the decision'),
  tone: z.string().describe('Communication tone used (e.g., "educational", "reassuring")'),
  wordCount: z.number().describe('Word count of the explanation'),
  confidence: z.number().min(0).max(1),
});
