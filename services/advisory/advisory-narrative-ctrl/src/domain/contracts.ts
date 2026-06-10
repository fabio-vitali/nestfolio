// Producer-owned contracts for advisory-narrative-ctrl. Imports zod + the service's agent schemas.
// NarrativeAgentOutput is the COMPOSITE runPipeline return (ExplainabilitySchema spread at top
// level + decisionId + metadata) stored as AgentCompletion.agentOutput and CDC-emitted on
// NARRATIVE_COMPLETED.
import { z } from 'zod';
import { ExplainabilitySchema } from '../agents/schemas';

export const NarrativeAgentOutputSchema = ExplainabilitySchema.extend({
  decisionId: z.string(),
  metadata: z.object({
    durationMs: z.number(),
    modelTier: z.string().optional(),
  }).passthrough(),
});
export type NarrativeAgentOutput = z.infer<typeof NarrativeAgentOutputSchema>;
