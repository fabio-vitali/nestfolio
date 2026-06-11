// Producer-owned subject contracts for advisory-bff. Imports ONLY zod.
// advisory-bff producers:
//   - projectVersioned('DecisionReadModel', …) (CDC: DECISION_READ_MODEL_CREATED/UPDATED)
//     written by TWO builders: decision-snapshot.ts (full) + decision-cycle-status.ts (minimal)
//   - JS .fn.js resolver intent rows UserConfirmation/UserRejection
//     (CDC: USER_CONFIRMED / USER_REJECTED)
// JS resolvers can't import this at runtime — these contracts validate the emitted shape
// (unit tests + e2e parseSubject gate).
import { z } from 'zod';

/**
 * DecisionReadModel subject — the `DecisionReadModel` row
 * (sk='DecisionReadModel', pk=`Decision#${tenantId}#${decisionId}`),
 * CDC-emitted as DECISION_READ_MODEL_CREATED / DECISION_READ_MODEL_UPDATED.
 *
 * TWO builders write this aggregate row:
 *   - decision-snapshot.ts (full):  decisionId, trigger, status, proposedTrades, explanation,
 *     confirmationRequired, confirmedAt?, rejectedAt?, rejectionReason?, complianceChecks,
 *     agentInvocations, version, taskToken?, createdAt, updatedAt
 *   - decision-cycle-status.ts (minimal): decisionId, status, trigger (''), version,
 *     createdAt, updatedAt  (omits proposedTrades/explanation/confirmationRequired/
 *     complianceChecks/agentInvocations — these MUST be optional)
 *
 * DRY rule: tenantId is identity (RequestContext) and is stripped from the subject.
 */
export const DecisionReadModelSchema = z.object({
  decisionId: z.string(),
  // Required, not optional: the minimal cycle-status builder writes trigger:'' (never undefined)
  // to keep the row query-valid (getPendingDecisions selects trigger as String!), so the field
  // is always present in both builders.
  trigger: z.string(),
  status: z.string(),
  // Fields only the full snapshot builder writes — optional so the minimal cycle-status row parses:
  proposedTrades: z.array(z.unknown()).optional(),
  explanation: z.string().optional(),
  confirmationRequired: z.boolean().optional(),
  complianceChecks: z.array(z.unknown()).optional(),
  agentInvocations: z.array(z.unknown()).optional(),
  // Fields written by the full builder as optional attributes:
  // confirmedAt + rejectedAt: absent on non-confirmed/non-rejected decisions (undefined, not null);
  // the DecisionSnapshot local type declares them `?: string` so `.optional()` is correct.
  confirmedAt: z.string().optional(),
  rejectedAt: z.string().optional(),
  // rejectionReason: copied from DecisionPacketSchema which declares `.nullable()` —
  // the gate parsed a REAL row with rejectionReason:null for a non-rejected decision.
  // Must be .nullable() (not just .optional()) to accept null from DDB.
  rejectionReason: z.string().nullable().optional(),
  // taskToken: absent on some rows (?: string in DecisionSnapshot), never null; .optional() is correct.
  taskToken: z.string().optional(),
  version: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DecisionReadModel = z.infer<typeof DecisionReadModelSchema>;

/**
 * UserConfirmation subject — the `UserConfirmation#${autoId}` intent row written by the
 * confirmDecision JS resolver, CDC-emitted as USER_CONFIRMED.
 * decisionId + taskToken are the critical fields, with distinct failure modes in
 * decision-workflow-ctrl/sfn-callback's USER_RESPONSE handler:
 *   - taskToken absent → the resumeStateMachine pipeline has no token, so no SendTaskSuccess
 *     is issued and the SF stays stuck at WaitForUserResponse (silent no-op).
 *   - decisionId absent → the handler's intents collapse to [] (`decisionId ? [...] : []`),
 *     so the DecisionPacket status update can't be located/addressed (its pk embeds decisionId).
 * taskToken is lifted from the existing DecisionReadModel by the get-decision-readback pre-step.
 *
 * DRY rule: tenantId + region (RequestContext identity) are stripped from the subject.
 */
export const UserConfirmationSchema = z.object({
  decisionId: z.string(),
  confirmedAt: z.string(),
  confirmedBy: z.string(),
  timestamp: z.string(),
  taskToken: z.string().optional(),
});
export type UserConfirmation = z.infer<typeof UserConfirmationSchema>;

/**
 * UserRejection subject — the `UserRejection#${autoId}` intent row written by the
 * rejectDecision JS resolver, CDC-emitted as USER_REJECTED.
 * rejectionReason carries the GraphQL `reason` argument (renamed by the resolver).
 * Same decisionId + taskToken failure modes as UserConfirmation in sfn-callback's
 * USER_RESPONSE handler: taskToken absent → no SendTaskSuccess, SF stays stuck (silent
 * no-op); decisionId absent → intents collapse to [] so no DecisionPacket update is addressed.
 *
 * DRY rule: tenantId + region (RequestContext identity) are stripped from the subject.
 */
export const UserRejectionSchema = z.object({
  decisionId: z.string(),
  rejectedAt: z.string(),
  rejectedBy: z.string(),
  rejectionReason: z.string(),
  timestamp: z.string(),
  taskToken: z.string().optional(),
});
export type UserRejection = z.infer<typeof UserRejectionSchema>;

/**
 * ADVISORY_STATUS_UPDATED — advisory-bff's command-owned AdvisoryStatus aggregate (DRY subject).
 * `__version` is RETAINED in the subject: dashboard-bff projects this row P3 keyed on the carried
 * `__version` (see advisory-status-projector.ts). `oldestGeneratingAt` is the min GENERATING
 * createdAt, or null. Identity (tenantId) + envelope travel in context, not the subject.
 */
export const AdvisoryStatusSchema = z.object({
  inFlightCount: z.number(),
  generatingCount: z.number(),
  failedCount: z.number(),
  oldestGeneratingAt: z.string().nullable(),
  __version: z.number(),
});
export type AdvisoryStatus = z.infer<typeof AdvisoryStatusSchema>;
