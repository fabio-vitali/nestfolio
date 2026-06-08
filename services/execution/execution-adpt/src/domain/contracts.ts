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
  tenantId: z.string(),
  userId: z.string(),
  region: z.string(),
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
