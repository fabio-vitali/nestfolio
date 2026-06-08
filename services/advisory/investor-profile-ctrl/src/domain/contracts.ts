// Producer-owned event payload contracts for investor-profile-ctrl. Imports ONLY zod.
import { z } from 'zod';

/**
 * Subject carried on INVESTOR_PROFILE_SNAPSHOT_CREATED and INVESTOR_PROFILE_SNAPSHOT_UPDATED.
 * The CDC pipeline publishes the full InvestorProfileSnapshot DDB row as the subject.
 * Shape is verified against InvestorProfileSnapshotRow in domain/models.ts and the
 * update() intent in handlers/event-listener.ts (agentOutput, sourceEventId, tenantId, userId).
 */
export const InvestorProfileSnapshotSchema = z.object({
  agentOutput: z.object({
    goals: z.array(z.string()),
    timeHorizon: z.string(),
    riskWillingness: z.string(),
    riskScore: z.number(),
    riskCategory: z.enum(['CONSERVATIVE', 'MODERATE', 'AGGRESSIVE']),
    regulatoryFlags: z.array(z.string()),
    suitabilityAssessment: z.string(),
    confidence: z.number(),
  }),
  sourceEventId: z.string().optional(),
  __version: z.number().optional(),
});

export type InvestorProfileSnapshot = z.infer<typeof InvestorProfileSnapshotSchema>;
