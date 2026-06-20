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
 * Single-symbol per row: one Order per ProposedTrade in the authorizing event's proposedTrades[].
 * orderId = `${authorizingEventId}#${index}` — deterministic, idempotent across redeliveries.
 */
export const OrderSchema = z.object({
  orderId: z.string(),
  decisionPacketId: z.string(),
  symbol: z.string(),
  side: z.enum(['BUY', 'SELL']),
  quantityOrAmountCents: z.number(),
  status: z.enum(['SUBMITTED', 'STAGED', 'REJECTED', 'PENDING']),
  reason: z.string().optional(),
  sourceEventId: z.string().optional(),
  timestamp: z.string(),
});
export type Order = z.infer<typeof OrderSchema>;

/**
 * StagedOrder subject — the `StagedOrder` row (sk='StagedOrder') written when the market is
 * closed, CDC-emitted as STAGED_ORDER_CREATED / STAGED_ORDER_UPDATED.
 * Single-symbol sibling to the Order row; orderId matches the parent Order.
 */
export const StagedOrderSchema = z.object({
  orderId: z.string(),
  symbol: z.string(),
  side: z.enum(['BUY', 'SELL']),
  quantityOrAmountCents: z.number(),
  stagedAt: z.string(),
  timestamp: z.string(),
});
export type StagedOrder = z.infer<typeof StagedOrderSchema>;
