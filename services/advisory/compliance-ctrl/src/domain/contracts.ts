// Producer-owned event/row subject contracts for compliance-ctrl. Imports ONLY zod.
// Dry aggregate — identity (tenantId/userId/region) travels in the event context (RequestContext).
import { z, type ZodTypeAny } from 'zod';

// `taskToken` carries the SF taskToken across the compliance hop. It is persisted
// onto the ComplianceCheck row so CDC re-emits it on DECISION_APPROVED |
// DECISION_BLOCKED, allowing decision-workflow-ctrl/sfn-callback.ts to call
// SendTaskSuccess. Without it, the SF execution remains stuck at WaitForCompliance.

/**
 * ComplianceCheck subject — the `ComplianceCheck` row (sk='ComplianceCheck') written by
 * event-listener on RECOMMENDATION_PROPOSED, CDC-emitted (value-mapped on `result`) as
 * DECISION_APPROVED (result=APPROVED) / DECISION_BLOCKED (result=BLOCKED). Enums verbatim from
 * rules/rule-engine.ts ComplianceOutput. `decisionId` is a dual-field alias of decisionPacketId.
 * `taskToken` is carried so decision-workflow-ctrl/sfn-callback can resume the SF. The row carries
 * NO proposedTrades (those ride RECOMMENDATION_PROPOSED).
 */
export const ComplianceCheckSchema = z.object({
  ccId: z.string(),
  decisionPacketId: z.string(),
  decisionId: z.string(),
  taskToken: z.string(),
  mandateSnapshot: z.object({
    level: z.enum(['ADVISORY', 'DISCRETIONARY']),
    status: z.enum(['ACTIVE', 'REVOKED']),
    operatingMode: z.enum(['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE']),
    effectiveDate: z.string(),
  }),
  status: z.enum(['COMPLETED', 'BLOCKED']),
  result: z.enum(['APPROVED', 'BLOCKED']),
  violations: z.array(z.object({
    rule: z.string(),
    description: z.string(),
    severity: z.enum(['WARNING', 'BLOCKING']),
  })),
  authorityLevel: z.enum(['L1', 'L2']),
  sourceEventId: z.string(),
});
export type ComplianceCheck = z.infer<typeof ComplianceCheckSchema>;

/**
 * Event-name → producer zod subject schema map for compliance-ctrl.
 * Consumed only by `@nestfolio/test-contracts` (typed-test-fixtures registry).
 * Inert at runtime.
 */
export const complianceCtrlEventSubjects = {
  DECISION_APPROVED: ComplianceCheckSchema,
  DECISION_BLOCKED: ComplianceCheckSchema,
} as const satisfies Record<string, ZodTypeAny>;
