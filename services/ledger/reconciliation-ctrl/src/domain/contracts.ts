// Producer-owned event payload contracts for reconciliation-ctrl. Imports ONLY zod.
import { z } from 'zod';

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
  drift: z.number(),
});
export type DriftRecord = z.infer<typeof DriftRecordSchema>;
