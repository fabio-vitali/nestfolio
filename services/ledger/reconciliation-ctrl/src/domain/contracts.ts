// Producer-owned event payload contracts for reconciliation-ctrl. Imports ONLY zod.
import { z, type ZodTypeAny } from 'zod';

/** ReconciliationResult subject — emitted as RECONCILIATION_COMPLETED (insert) /
 * RECONCILIATION_RESULT_UPDATED (modify). Dry subject — identity travels in the
 * event context (RequestContext), not here. */
export const ReconciliationResultSchema = z.object({
  reconciliationId: z.string(),
  status: z.enum(['COMPLETED', 'DRIFT_DETECTED']),
  driftCount: z.number(),
});
export type ReconciliationResult = z.infer<typeof ReconciliationResultSchema>;

/** DriftRecord subject — emitted as PORTFOLIO_DRIFT_DETECTED (insert) /
 * DRIFT_RECORD_UPDATED (modify). Dry subject — identity travels in the context. */
export const DriftRecordSchema = z.object({
  reconciliationId: z.string(),
  instrument: z.string(),
  intentQty: z.number(),
  settlementQty: z.number(),
  drift: z.number(), // intentQty - settlementQty; may be negative (over-settled)
});
export type DriftRecord = z.infer<typeof DriftRecordSchema>;

/**
 * Test-fixture event→subject map for reconciliation-ctrl's CDC emissions. Co-located with the
 * producer-owned schemas; consumed only by `@nestfolio/test-contracts`. Only RECONCILIATION_COMPLETED
 * is registered: PORTFOLIO_DRIFT_DETECTED is deferred (its name collides with the unbuilt
 * weight-drift rebalance event consumed by decision-workflow-ctrl — see the Phase-4 plan / backlog).
 */
export const reconciliationCtrlEventSubjects = {
  RECONCILIATION_COMPLETED: ReconciliationResultSchema,
} as const satisfies Record<string, ZodTypeAny>;
