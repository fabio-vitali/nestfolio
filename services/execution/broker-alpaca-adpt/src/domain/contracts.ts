// Producer-owned event/row subject contracts for broker-alpaca-adpt. Imports ONLY zod.
// Dry aggregates — identity travels in the event context, not on the subject.
import { z } from 'zod';
import type { ZodTypeAny } from 'zod';
import { AlpacaTransferResultSchema } from '@nestfolio/execution-adpt/domain';

/** ALPACA_ORDER_* subject — the `AlpacaOrderResult` row (sk='OrderMapping'|'CancelResult').
 * symbol/side/requestedQty are present on PLACED/REJECTED, absent on CancelResult. Tenant-scoped.
 * `timestamp` is written by order-mapping.repository.createMapping (PLACED) but ABSENT on the
 * event-listener rejection/cancel/error emissions (those rely on the pipeline-injected `createdAt`),
 * so it is optional on the aggregate — see backlog broker-alpaca-result-timestamp-drift. */
export const AlpacaOrderResultSchema = z.object({
  nestfolioOrderId: z.string(),
  alpacaOrderId: z.string().optional(),
  status: z.enum(['PLACED', 'FILLED', 'PARTIALLY_FILLED', 'REJECTED', 'CANCELLED', 'CANCEL_FAILED']),
  symbol: z.string().optional(),
  side: z.string().optional(),
  requestedQty: z.number().optional(),
  filledQuantity: z.number().optional(),
  averageFillPrice: z.number().optional(),
  rejectionReason: z.string().optional(),
  timestamp: z.string().optional(),
});
export type AlpacaOrderResult = z.infer<typeof AlpacaOrderResultSchema>;

/** ALPACA_ACCOUNT_SNAPSHOT subject — the `AlpacaAccountSnapshot` row (sk='Snapshot#${ts}').
 * equity/buyingPower are null on the failure path. No `timestamp` on the subject (it is in sk). */
export const AlpacaAccountSnapshotSchema = z.object({
  // equity/buyingPower are raw Alpaca API strings (NOT Number()-converted like positions) — latent inconsistency tracked by backlog broker-alpaca-account-snapshot-equity-string-drift.
  equity: z.string().nullable(),
  buyingPower: z.string().nullable(),
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

/** ALPACA_ACCOUNT_CHECK is an empty-payload trigger — the handler reads no subject fields. */
export const AlpacaAccountCheckSchema = z.object({});

/**
 * Test-fixture event→subject map for broker-alpaca-adpt's CDC emissions. Co-located with the
 * producer-owned schemas; consumed only by `@nestfolio/test-contracts`.
 */
export const brokerAlpacaAdptEventSubjects = {
  ALPACA_ACCOUNT_CHECK: AlpacaAccountCheckSchema,
  ALPACA_ORDER_CANCEL_FAILED: AlpacaOrderResultSchema,
  ALPACA_ORDER_CANCELLED: AlpacaOrderResultSchema,
  ALPACA_ORDER_FILLED: AlpacaOrderResultSchema,
  ALPACA_ORDER_PARTIALLY_FILLED: AlpacaOrderResultSchema,
  ALPACA_ORDER_PLACED: AlpacaOrderResultSchema,
  ALPACA_ORDER_REJECTED: AlpacaOrderResultSchema,
  ALPACA_TRANSFER_COMPLETED: AlpacaTransferResultSchema,
  ALPACA_TRANSFER_FAILED: AlpacaTransferResultSchema,
  ALPACA_TRANSFER_INITIATED: AlpacaTransferResultSchema,
} as const satisfies Record<string, ZodTypeAny>;
