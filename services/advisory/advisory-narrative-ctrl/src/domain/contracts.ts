// Producer-owned contracts for advisory-narrative-ctrl. Imports zod + the service's agent schemas.
// NarrativeAgentOutput is the COMPOSITE runPipeline return (ExplainabilitySchema spread at top
// level + decisionId + metadata) stored as AgentCompletion.agentOutput and CDC-emitted on
// NARRATIVE_COMPLETED.
import { z } from 'zod';
import type { ZodTypeAny } from 'zod';
import { ExplainabilitySchema } from '../agents/schemas';
import { AgentCompletionRowSchema, AgentFailureRowSchema } from '@nestfolio/agent-orchestrator';

export const NarrativeAgentOutputSchema = ExplainabilitySchema.extend({
  decisionId: z.string(),
  metadata: z.object({
    durationMs: z.number(),
    modelTier: z.string().optional(),
  }).passthrough(),
});
export type NarrativeAgentOutput = z.infer<typeof NarrativeAgentOutputSchema>;

/** NARRATIVE_COMPLETED — the AgentCompletion row subject (agentOutput = NarrativeAgentOutput). */
export const NarrativeAgentCompletionSchema = AgentCompletionRowSchema('advisory-narrative', NarrativeAgentOutputSchema);
export type NarrativeAgentCompletion = z.infer<typeof NarrativeAgentCompletionSchema>;

/** NARRATIVE_FAILED — the AgentFailure row subject. */
export const NarrativeAgentFailureSchema = AgentFailureRowSchema('advisory-narrative');
export type NarrativeAgentFailure = z.infer<typeof NarrativeAgentFailureSchema>;

/**
 * EXPLANATION_GENERATED — the ReasoningOutput row subject (DRY). The row is
 * `{ invocationId, decisionId, ...explainability }` (+ envelope); identity travels in context.
 * (Built by agent-service.ts:127 via buildCdcItem('ReasoningOutput', …).)
 */
export const ExplanationGeneratedSchema = ExplainabilitySchema.extend({
  invocationId: z.string(),
  decisionId: z.string(),
});
export type ExplanationGenerated = z.infer<typeof ExplanationGeneratedSchema>;

/**
 * Test-fixture event→subject map for advisory-narrative-ctrl's emissions. Co-located with the
 * producer-owned schemas (single source of truth); consumed only by
 * `@nestfolio/test-contracts`. Bare string-literal keys so `keyof typeof` is a literal union.
 */
export const advisoryNarrativeCtrlEventSubjects = {
  NARRATIVE_COMPLETED: NarrativeAgentCompletionSchema,
  NARRATIVE_FAILED: NarrativeAgentFailureSchema,
  EXPLANATION_GENERATED: ExplanationGeneratedSchema,
} as const satisfies Record<string, ZodTypeAny>;
