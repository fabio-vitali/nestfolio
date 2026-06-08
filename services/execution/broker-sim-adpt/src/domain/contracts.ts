// Producer-owned CDC subject contracts for broker-sim-adpt.
// These schemas describe the DDB rows emitted as CDC subjects on SIM_DEPOSIT_COMPLETED
// and SIM_WITHDRAWAL_COMPLETED. Separate from the inbound-event schemas in schemas.ts.
import { z } from 'zod';

/**
 * Subject shape for SIM_DEPOSIT_COMPLETED.
 * Emitted from the `DepositDetected` DDB row written by event-listener.ts
 * SIM_DEPOSIT_INITIATED handler (record(...) call).
 * Fields: depositId, amountCents, currency, userId, tenantId, sourceEventId, timestamp.
 * userId is explicitly written to the row (not pickRequestContext — it is spread from subject).
 */
export const SimDepositCompletedSchema = z.object({
  depositId: z.string(),
  amountCents: z.number().int().positive(),
  currency: z.string(),
  userId: z.string().optional(), // present when the inbound SIM_DEPOSIT_INITIATED carried userId
  tenantId: z.string(),
  sourceEventId: z.string(),
  timestamp: z.string(),
});
export type SimDepositCompleted = z.infer<typeof SimDepositCompletedSchema>;
