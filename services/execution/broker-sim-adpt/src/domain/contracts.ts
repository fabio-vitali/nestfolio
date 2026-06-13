// Producer-owned CDC subject contracts for broker-sim-adpt.
// These schemas describe the DDB rows emitted as CDC subjects on SIM_DEPOSIT_COMPLETED
// and SIM_WITHDRAWAL_COMPLETED. Separate from the inbound-event schemas in schemas.ts.
import { z } from 'zod';

/**
 * Subject shape for SIM_DEPOSIT_COMPLETED.
 * Emitted from the `DepositDetected` DDB row written by event-listener.ts
 * SIM_DEPOSIT_INITIATED handler (record(...) call). DRY — identity (userId/tenantId)
 * travels in the event context (RequestContext), not on the subject.
 * Fields: depositId, amountCents, currency, sourceEventId, timestamp.
 */
export const SimDepositCompletedSchema = z.object({
  depositId: z.string(),
  amountCents: z.number().int().positive(),
  currency: z.string(),
  sourceEventId: z.string(),
  timestamp: z.string(),
});
export type SimDepositCompleted = z.infer<typeof SimDepositCompletedSchema>;

/**
 * SIM_WITHDRAWAL_COMPLETED subject — the `WithdrawalCompleted` row written by
 * event-listener on SIM_WITHDRAWAL_REQUESTED. NOTE: carries `amount` (dollars),
 * NOT amountCents (deposit/withdrawal asymmetry — tracked by
 * broker-funding-completed-normalization-drift, out of scope here). Dry — identity
 * travels in the event context.
 */
export const SimWithdrawalCompletedSchema = z.object({
  withdrawalId: z.string(),
  amount: z.number().positive(),
  sourceEventId: z.string(),
  timestamp: z.string(),
});
export type SimWithdrawalCompleted = z.infer<typeof SimWithdrawalCompletedSchema>;

/** SIM_ORDER_FILLED / SIM_ORDER_REJECTED subject — the `VirtualTrade` row written by the
 * simulation engine. (The row carries no `status`; the Egress status=REJECTED branch is
 * a latent dead mapping — out of scope.) Dry — identity travels in the event context. */
export const VirtualTradeSchema = z.object({
  tradeId: z.string(),
  orderId: z.string(),
  symbol: z.string(),
  side: z.enum(['BUY', 'SELL']),
  quantity: z.number(),
  fillPrice: z.number(),
  totalValue: z.number(),
  cashBefore: z.number(),
  cashAfter: z.number(),
  executedAt: z.string(),
});
export type VirtualTrade = z.infer<typeof VirtualTradeSchema>;

/** Internal (NOT CDC-emitted) virtual-ledger read-model rows. Tenant+user-scoped.
 * Dry subjects — generic envelope timestamps (createdAt/updatedAt) are excluded;
 * they live on the TableEntry envelope, not the business subject. */
export const VirtualCashBalanceSchema = z.object({
  currency: z.string(),
  balance: z.number(),
  version: z.number(),
});
export type VirtualCashBalance = z.infer<typeof VirtualCashBalanceSchema>;

export const VirtualPositionSchema = z.object({
  symbol: z.string(),
  quantity: z.number(),
  averageCostBasis: z.number(),
  marketValue: z.number(),
});
export type VirtualPosition = z.infer<typeof VirtualPositionSchema>;

export const VirtualSnapshotSchema = z.object({
  date: z.string(),
  cashBalance: z.number(),
  positions: z.array(z.unknown()),
  totalValue: z.number(),
});
export type VirtualSnapshot = z.infer<typeof VirtualSnapshotSchema>;
