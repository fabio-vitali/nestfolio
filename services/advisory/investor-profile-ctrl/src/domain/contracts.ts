// Producer-owned event payload contracts for investor-profile-ctrl.
// Imports zod + the agent sub-schemas (mirrors how portfolio-engine-ctrl/advisory-narrative-ctrl
// compose their agent schemas into the producer contract).
import { z } from 'zod';
import type { ZodTypeAny } from 'zod';
import { GoalInterpretationSchema, RiskEvaluationSchema } from '../agents/schemas';

/**
 * Subject carried on INVESTOR_PROFILE_SNAPSHOT_CREATED and INVESTOR_PROFILE_SNAPSHOT_UPDATED.
 * The CDC pipeline publishes the full InvestorProfileSnapshot DDB row as the subject.
 *
 * agentOutput is the COMPOSITE return value of agent-service.ts:
 *   { decisionId, goals: GoalInterpretation, risk: RiskEvaluation, metadata }
 *
 * The previously declared flat shape (goals[], timeHorizon, riskScore, riskCategory, …)
 * was WRONG — corrected 2026-06-10 by the e2e validation gate (real deployed emission
 * failed to parse against the old schema; a co-wrong unit fixture had hidden the drift).
 *
 * Shape is verified against InvestorProfileSnapshotRow in domain/models.ts and the
 * update() intent in handlers/event-listener.ts (agentOutput, sourceEventId, tenantId, userId).
 */
export const InvestorProfileSnapshotSchema = z.object({
  agentOutput: z.object({
    decisionId: z.string(),
    goals: GoalInterpretationSchema,
    risk: RiskEvaluationSchema,
    metadata: z.object({
      durationMs: z.number(),
      modelTiers: z.array(z.string()).optional(),
    }).passthrough(),
  }),
  sourceEventId: z.string().optional(),
  __version: z.number().optional(),
});

export type InvestorProfileSnapshot = z.infer<typeof InvestorProfileSnapshotSchema>;

/**
 * Test-fixture event→subject map for investor-profile-ctrl's emissions. Co-located with the
 * producer-owned schemas (single source of truth); consumed only by `@nestfolio/test-contracts`.
 * Bare string-literal keys so `keyof typeof` is a literal union.
 */
export const investorProfileCtrlEventSubjects = {
  INVESTOR_PROFILE_SNAPSHOT_CREATED: InvestorProfileSnapshotSchema,
  INVESTOR_PROFILE_SNAPSHOT_UPDATED: InvestorProfileSnapshotSchema,
} as const satisfies Record<string, ZodTypeAny>;
