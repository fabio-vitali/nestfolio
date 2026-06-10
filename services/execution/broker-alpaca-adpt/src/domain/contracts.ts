// Producer-owned event/row subject contracts for broker-alpaca-adpt. Imports ONLY zod.
// Dry aggregates — identity travels in the event context, not on the subject.
import { z } from 'zod';

/** ALPACA_ORDER_* subject — the `AlpacaOrderResult` row (sk='OrderMapping'|'CancelResult').
 * symbol/side/requestedQty are present on PLACED/REJECTED, absent on CancelResult. Tenant-scoped. */
export const AlpacaOrderResultSchema = z.object({
  nestfolioOrderId: z.string(),
  alpacaOrderId: z.string(),
  status: z.enum(['PLACED', 'FILLED', 'PARTIALLY_FILLED', 'REJECTED', 'CANCELLED', 'CANCEL_FAILED']),
  symbol: z.string().optional(),
  side: z.string().optional(),
  requestedQty: z.number().optional(),
  filledQuantity: z.number().optional(),
  averageFillPrice: z.number().optional(),
  rejectionReason: z.string().optional(),
  timestamp: z.string(),
});
export type AlpacaOrderResult = z.infer<typeof AlpacaOrderResultSchema>;

/** ALPACA_TRANSFER_* subject — the `AlpacaTransferResult` row (sk='TransferMapping'). */
export const AlpacaTransferResultSchema = z.object({
  nestfolioTransferId: z.string(),
  alpacaTransferId: z.string(),
  direction: z.enum(['INCOMING', 'OUTGOING']),
  amount: z.number(),
  status: z.enum(['INITIATED', 'COMPLETED', 'FAILED']),
  failureReason: z.string().optional(),
  timestamp: z.string(),
});
export type AlpacaTransferResult = z.infer<typeof AlpacaTransferResultSchema>;

/** ALPACA_ACCOUNT_SNAPSHOT subject — the `AlpacaAccountSnapshot` row (sk='Snapshot#${ts}').
 * equity/buyingPower are null on the failure path. No `timestamp` on the subject (it is in sk). */
export const AlpacaAccountSnapshotSchema = z.object({
  equity: z.number().nullable(),
  buyingPower: z.number().nullable(),
  positions: z.array(z.object({
    symbol: z.string(),
    qty: z.number(),
    marketValue: z.number(),
  })),
  status: z.string().optional(),
  failureReason: z.string().optional(),
});
export type AlpacaAccountSnapshot = z.infer<typeof AlpacaAccountSnapshotSchema>;

/** BROKER_CIRCUIT_OPEN/CLOSED/ESCALATED subject — the circuit-breaker `NormalizedEvent` row. */
export const BrokerCircuitEventSchema = z.object({
  adapter: z.string(),
  timestamp: z.string(),
});
export type BrokerCircuitEvent = z.infer<typeof BrokerCircuitEventSchema>;

/** CircuitBreaker state row (sk='CircuitBreaker', pk='CircuitBreaker#${adapter}') — global
 * per-adapter, NOT CDC-emitted, NO tenant identity. */
export const CircuitBreakerSchema = z.object({
  state: z.enum(['OPEN', 'CLOSED']),
  adapter: z.string(),
  openedAt: z.string(),
  closedAt: z.string().optional(),
  reason: z.string(),
});
export type CircuitBreaker = z.infer<typeof CircuitBreakerSchema>;
