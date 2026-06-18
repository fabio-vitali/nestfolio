// Producer-owned event/row subject contracts for broker-ctrl. Imports ONLY zod.
// Dry aggregates — identity (tenantId/userId/region) travels in the event context, not here.
import { z } from 'zod';
import type { ZodTypeAny } from 'zod';
import { AlpacaTransferRequestSchema } from '@nestfolio/execution-adpt/domain';

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

/**
 * DRY subject for the order-routing commands broker-ctrl emits to the broker adapters
 * (SIM_ORDER_REQUESTED / ALPACA_ORDER_REQUESTED). Identity (userId/tenantId) is carried in the
 * envelope context, not the subject. NB: the live producer (route-order.ts) currently also puts
 * userId on the subject — tracked as a latent non-DRY producer bug (see Task 5 filing).
 */
export const BrokerOrderRequestSchema = z.object({
  orderId: z.string(),
  symbol: z.string(),
  side: z.enum(['BUY', 'SELL']),
  quantity: z.number(),
});

/** DRY subject for the deposit-routing command broker-ctrl emits to broker-sim (SIM_DEPOSIT_INITIATED). */
export const SimDepositInitiatedSubjectSchema = z.object({
  depositId: z.string(),
  amountCents: z.number().int().positive(),
  currency: z.string(),
  direction: z.literal('INCOMING'),
});

/** DRY subject for the withdrawal-routing command broker-ctrl emits to broker-sim (SIM_WITHDRAWAL_REQUESTED). */
export const SimWithdrawalRequestedSubjectSchema = z.object({
  withdrawalId: z.string(),
  amountCents: z.number().int().positive(),
  currency: z.string(),
  direction: z.literal('OUTGOING'),
});

/**
 * Test-fixture event→subject map for broker-ctrl's emissions. Co-located with the producer-owned
 * schemas; consumed only by `@nestfolio/test-contracts`. Grows across Tasks 3 and 4.
 */
export const brokerCtrlEventSubjects = {
  ALPACA_ORDER_REQUESTED: BrokerOrderRequestSchema,
  ALPACA_TRANSFER_REQUESTED: AlpacaTransferRequestSchema,
  SIM_DEPOSIT_INITIATED: SimDepositInitiatedSubjectSchema,
  SIM_ORDER_REQUESTED: BrokerOrderRequestSchema,
  SIM_WITHDRAWAL_REQUESTED: SimWithdrawalRequestedSubjectSchema,
} as const satisfies Record<string, ZodTypeAny>;
