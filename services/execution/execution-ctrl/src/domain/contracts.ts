// Producer-owned event/row subject contracts for execution-ctrl. Imports ONLY zod.
// Dry aggregates — identity travels in the event context, not on the subject.
import { z } from 'zod';
import type { ZodTypeAny } from 'zod';

/**
 * Order subject — the `Order` row (sk='Order') written by event-listener on
 * DECISION_APPROVED / USER_CONFIRMED, CDC-emitted as ORDER_CREATED (default insert) /
 * ORDER_SUBMITTED / ORDER_STAGED / ORDER_REJECTED / ORDER_UPDATED (modify default).
 * The live event-listener path writes SUBMITTED/STAGED/REJECTED; 'PENDING' is a legacy
 * status value (formerly written by the now-removed OrderRepository.createOrder) — retained
 * in the enum for backward-compat with any historical Order rows.
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

/**
 * Test-fixture event→subject map for execution-ctrl's emissions. Co-located with the producer-owned
 * schemas; consumed only by `@nestfolio/test-contracts` for typed test fixtures (lets tests inject a
 * typed ORDER_SUBMITTED to drive the real order→fill→ledger path — order-execution-money-path WS-5).
 * Only ORDER_SUBMITTED is registered: ORDER_REJECTED/ORDER_CANCELLED are owned in the registry by
 * broker-ctrl's NormalizedOrderEventSchema (the fill-side rejection), so registering execution-ctrl's
 * order-creation ORDER_REJECTED here would collide. Grows as typed injection needs more order events.
 */
export const executionCtrlEventSubjects = {
  ORDER_SUBMITTED: OrderSchema,
} as const satisfies Record<string, ZodTypeAny>;
