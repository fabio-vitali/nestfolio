// Producer-owned event/row subject contracts for decision-workflow-ctrl. Imports ONLY zod.
// Dry aggregates — identity (tenantId/userId/region) travels in the event context.
import { z } from 'zod';

/**
 * DecisionPacket subject — the `DecisionPacket` row (sk='DecisionPacket',
 * pk=`DecisionPacket#${tenantId}#${decisionId}`), CDC-emitted as
 * DECISION_PACKET_CREATED (insert) / DECISION_PACKET_UPDATED (modify).
 * Identity fields (tenantId, userId, region) are excluded — they travel in the event context.
 */
export const DecisionPacketSchema = z.object({
  decisionId: z.string(),
  trigger: z.string(),
  triggerEventId: z.string(),
  executionArn: z.string().nullable(),
  explanation: z.string(),
  proposedTrades: z.array(z.unknown()),
  confirmationRequired: z.boolean(),
  status: z.string(), // z.string() — WorkflowStatus has 8 values, all retained for safety
  __version: z.number(),
  complianceResult: z.string().nullable(),
  authorityLevel: z.string().nullable(),
  userDecision: z.string().nullable(),
  blockReason: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  timestamp: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DecisionPacket = z.infer<typeof DecisionPacketSchema>;

/**
 * MandateSnapshot subject — the `MandateSnapshot` row (sk='MandateSnapshot'),
 * CDC-emitted as MANDATE_SNAPSHOT_CREATED (insert only).
 * __version is optional so mandate-projector can read it from the parsed subject
 * (rather than raw payload.subject.__version with a cast).
 */
export const MandateSnapshotSchema = z.object({
  mandateId: z.string().optional(),
  level: z.string().optional(),
  operatingMode: z.string(),
  effectiveDate: z.string().optional(),
  // status is optional: investor-bff may omit it on some payloads;
  // mandate-projector defaults to 'ACTIVE' if absent.
  status: z.string().optional(),
  __version: z.number().optional(),
});
export type MandateSnapshot = z.infer<typeof MandateSnapshotSchema>;

/**
 * RECOMMENDATION_PROPOSED subject — SF-direct putEvents (raw ASL in
 * decision-state-machine.ts, no row/__typename). tenantId/userId excluded (identity/context).
 */
export const RecommendationProposedSchema = z.object({
  decisionId: z.string(),
  taskToken: z.string(),
  awaitingCompliance: z.literal(true),
  proposedTrades: z.array(z.unknown()),
  portfolioValueCents: z.number(),
  isInitialBuild: z.boolean(),
  riskCategory: z.string(),
  currentPositions: z.array(z.unknown()),
});
export type RecommendationProposed = z.infer<typeof RecommendationProposedSchema>;

/**
 * DECISION_CYCLE_STARTED subject — SF-direct fire-and-forget.
 * tenantId excluded (identity/context).
 */
export const DecisionCycleStartedSchema = z.object({
  decisionId: z.string(),
  status: z.literal('GENERATING'),
  __version: z.literal(0),
});
export type DecisionCycleStarted = z.infer<typeof DecisionCycleStartedSchema>;

/**
 * DECISION_CYCLE_FAILED subject — SF-direct, shared pre-packet Catch.
 * tenantId excluded (identity/context).
 */
export const DecisionCycleFailedSchema = z.object({
  decisionId: z.string(),
  status: z.literal('FAILED'),
  __version: z.literal(1),
});
export type DecisionCycleFailed = z.infer<typeof DecisionCycleFailedSchema>;
