import { z } from 'zod';

export const ExplanationSchema = z.object({
  summary: z
    .string()
    .min(1)
    .describe('One-paragraph executive summary of the decision'),
  keyFactors: z
    .array(z.string().min(1))
    .min(1)
    .describe('Ordered list of factors that drove the decision'),
  riskWarnings: z
    .array(z.string())
    .describe('Potential risks the user should be aware of'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('Overall confidence in the recommendation (0-1)'),
  humanReadableRationale: z
    .string()
    .min(1)
    .describe('Plain-English rationale suitable for non-expert users'),
});

export type Explanation = z.infer<typeof ExplanationSchema>;
