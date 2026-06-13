import { z } from 'zod';

/**
 * CDC subject shape emitted by broker-ctrl for every funding lifecycle transition
 * (DEPOSIT_REQUESTED, DEPOSIT_DETECTED, DEPOSIT_SETTLED, DEPOSIT_FAILED,
 *  WITHDRAWAL_REQUESTED, WITHDRAWAL_SETTLED, WITHDRAWAL_FAILED).
 *
 * Produced by the execution domain (broker-ctrl owns the funding lifecycle);
 * forwarded to InvestorBus by investor-adpt and projected by investor-bff into
 * Deposit / WithdrawalRequest read-model rows.
 *
 * Owned here in the PRODUCER's cross-domain adapter (execution-adpt/domain) —
 * matching the ProposedTrade precedent (advisory-adpt/domain owns ProposedTrade,
 * which advisory produces and execution-ctrl consumes). Breaks the
 * broker-ctrl ↔ investor-bff circular dependency.
 */
export const FundingSnapshotSchema = z.object({
  sk: z.string(), // CDC passthrough field — the lifecycle event name (DEPOSIT_SETTLED, etc.)
  direction: z.enum(['DEPOSIT', 'WITHDRAWAL']),
  status: z.enum(['requested', 'detected', 'settled', 'failed']),
  transferId: z.string(),
  amountCents: z.number(),
  currency: z.string(),
  executionMode: z.enum(['simulation', 'live']),
  initiatedAt: z.string(),
  detectedAt: z.string().optional(),
  settledAt: z.string().optional(),
  failedAt: z.string().optional(),
  reason: z.string().optional(),
  timestamp: z.string(),
  __version: z.number().optional(), // CDC-added; absent on the carrier row itself
});

export type FundingSnapshot = z.infer<typeof FundingSnapshotSchema>;

/**
 * ALPACA_TRANSFER_REQUESTED subject — produced by broker-ctrl's deposit-withdrawal-router
 * (live branch), consumed by broker-alpaca-adpt's event-listener.
 *
 * Hosted here (NOT in broker-ctrl/contracts) because broker-ctrl and broker-alpaca are a
 * MUTUAL producer/consumer pair (broker-ctrl also consumes AlpacaTransferResult); mutual
 * `<svc>/contracts` imports would form a project cycle. Same precedent as FundingSnapshot.
 * DRY — identity travels in RequestContext. `transferId` IS the nestfolio depositId/withdrawalId,
 * threaded end-to-end so the completion can re-find the requested funding carrier.
 */
export const AlpacaTransferRequestSchema = z.object({
  transferId: z.string(),
  amountCents: z.number().int().positive(),
  currency: z.string(),
  direction: z.enum(['INCOMING', 'OUTGOING']),
  relationshipId: z.string(),
});

export type AlpacaTransferRequest = z.infer<typeof AlpacaTransferRequestSchema>;

/**
 * ALPACA_TRANSFER_* result subject — the broker-alpaca-adpt `AlpacaTransferResult` row
 * (sk='TransferMapping'). Produced by broker-alpaca-adpt, consumed by broker-ctrl's
 * deposit-withdrawal-normalizer. Hosted here for the same mutual-boundary cycle reason as
 * AlpacaTransferRequest. `nestfolioTransferId` IS the threaded transferId (= depositId/withdrawalId).
 * `timestamp` optional — absent on event-listener emissions (see backlog broker-alpaca-result-timestamp-drift).
 */
export const AlpacaTransferResultSchema = z.object({
  nestfolioTransferId: z.string(),
  alpacaTransferId: z.string(),
  direction: z.enum(['INCOMING', 'OUTGOING']),
  amount: z.number(),
  status: z.enum(['INITIATED', 'COMPLETED', 'FAILED']),
  failureReason: z.string().optional(),
  timestamp: z.string().optional(),
});

export type AlpacaTransferResult = z.infer<typeof AlpacaTransferResultSchema>;
