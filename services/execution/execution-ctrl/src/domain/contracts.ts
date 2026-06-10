// Producer-owned event/row subject contracts for execution-ctrl. Imports ONLY zod.
// Dry aggregates — identity travels in the event context, not on the subject.
import { z } from 'zod';

/**
 * Order subject — the `Order` row (sk='Order') written by event-listener on
 * DECISION_APPROVED / USER_CONFIRMED, CDC-emitted as ORDER_CREATED (default insert) /
 * ORDER_SUBMITTED / ORDER_STAGED / ORDER_REJECTED / ORDER_UPDATED (modify default).
 * The live event-listener path writes SUBMITTED/STAGED/REJECTED; 'PENDING' is the dead
 * OrderRepository.createOrder value (kept for completeness).
 *
 * `proposedTrades` nests advisory-produced ProposedTrade[] (advisory-adpt/domain). It is
 * converted to zod in the Advisory slice (4); typed loosely here. execution-ctrl imports
 * the ProposedTrade interface UNCHANGED.
 */
export const OrderSchema = z.object({
  orderId: z.string(),
  decisionPacketId: z.string(),
  proposedTrades: z.array(z.unknown()),
  status: z.enum(['SUBMITTED', 'STAGED', 'REJECTED', 'PENDING']),
  reason: z.string().optional(),
  sourceEventId: z.string().optional(),
  timestamp: z.string(),
});
export type Order = z.infer<typeof OrderSchema>;

/** StagedOrder subject — the `StagedOrder` row (sk='StagedOrder') written when the market is
 * closed, CDC-emitted as STAGED_ORDER_CREATED / STAGED_ORDER_UPDATED. */
export const StagedOrderSchema = z.object({
  orderId: z.string(),
  proposedTrades: z.array(z.unknown()),
  stagedAt: z.string(),
  timestamp: z.string(),
});
export type StagedOrder = z.infer<typeof StagedOrderSchema>;
