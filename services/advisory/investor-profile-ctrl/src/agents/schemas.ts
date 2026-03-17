import { z } from 'zod';

export const GoalInterpretationSchema = z.object({
  goals: z.array(z.string()).describe('Identified investor goals'),
  timeHorizon: z.string().describe('Investment time horizon (e.g., "5-10 years")'),
  riskWillingness: z.string().describe('Stated risk appetite (e.g., "moderate")'),
  confidence: z.number().min(0).max(1).describe('Confidence score 0-1'),
});

export const RiskEvaluationSchema = z.object({
  riskScore: z.number().min(0).max(100).describe('Numeric risk score 0-100'),
  riskCategory: z.enum(['CONSERVATIVE', 'MODERATE', 'AGGRESSIVE']),
  regulatoryFlags: z.array(z.string()).describe('Regulatory concerns or warnings'),
  suitabilityAssessment: z.string().describe('Suitability narrative'),
  confidence: z.number().min(0).max(1).describe('Confidence score 0-1'),
});
