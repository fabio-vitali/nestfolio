// Producer-owned event/row subject contracts for broker-ctrl. Imports ONLY zod.
// Dry aggregates — identity (tenantId/userId/region) travels in the event context, not here.
import { z } from 'zod';

/**
 * ORDER lifecycle subject — the `NormalizedEvent` row (sk=`ORDER_*#${ts}`) written by the
 * order state machine and CDC-emitted as ORDER_FILLED / ORDER_PARTIALLY_FILLED /
 * ORDER_REJECTED / ORDER_CANCELLED / ORDER_ESCALATED. Named for the event (the funding
 * carrier is a separate `FundingEvent` typename). `amount`/`currency` on the old row schema
 * were funding-vestigial — the order path never writes them.
 */
export const NormalizedOrderEventSchema = z.object({
  orderId: z.string(),
  executionMode: z.enum(['simulation', 'live']),
  filledQty: z.number().optional(),
  averageFillPrice: z.number().optional(),
  failureReason: z.string().optional(),
  timestamp: z.string(),
});
export type NormalizedOrderEvent = z.infer<typeof NormalizedOrderEventSchema>;

/**
 * BrokerOrder state row (sk='BrokerOrder') — internal mutable order-routing state, NOT
 * CDC-emitted. Tenant-scoped only (the row carries no userId/region).
 */
export const BrokerOrderSchema = z.object({
  orderId: z.string(),
  executionMode: z.enum(['simulation', 'live']),
  state: z.enum(['ROUTING', 'AWAITING_FILL', 'FILLED', 'PARTIALLY_FILLED', 'REJECTED', 'CANCELLED', 'ESCALATED']),
  routedTo: z.enum(['sim', 'alpaca']),
  fillTaskToken: z.string().optional(),
  requestedQty: z.number(),
  filledQty: z.number(),
  remainingQty: z.number(),
  averageFillPrice: z.number().optional(),
  retryCount: z.number(),
  instrumentId: z.string(),
  routedAt: z.string(),
  filledAt: z.string().optional(),
  failureReason: z.string().optional(),
});
export type BrokerOrder = z.infer<typeof BrokerOrderSchema>;

/** ExecutionMode cache row (sk='ExecutionMode') — single per-tenant operating mode
 * (CommandOwned). NOT CDC-emitted. Tenant-scoped only. */
export const ExecutionModeSchema = z.object({
  mode: z.enum(['simulation', 'live']),
  updatedAt: z.string(),
});
export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;
