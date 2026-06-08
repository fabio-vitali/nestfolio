import { z } from 'zod';

/**
 * Subject shape for DEPOSIT_INITIATED.
 * Emitted from the DepositIntent DDB row (initiate-deposit.fn.js resolver in investor-bff).
 * Produced by the investor domain; forwarded to ExecutionBus by execution-adpt and
 * consumed by broker-ctrl to route deposits to the correct adapter (sim or alpaca).
 *
 * Owned here in the PRODUCER's cross-domain adapter (investor-adpt/domain) —
 * matching the ProposedTrade precedent (advisory-adpt/domain owns ProposedTrade,
 * which advisory produces and execution-ctrl consumes). Breaks the
 * broker-ctrl ↔ investor-bff circular dependency.
 */
export const DepositInitiatedSubjectSchema = z.object({
  depositId: z.string(),
  amountCents: z.number().int().positive(),
  currency: z.string(),
  userId: z.string().optional(), // present; Cognito-supplied via stash
  tenantId: z.string(),
  region: z.string().optional(), // set from ctx.stash.region by the AppSync resolver
  status: z.string().optional(),
  initiatedAt: z.string().optional(),
  timestamp: z.string(),
});
export type DepositInitiatedSubject = z.infer<typeof DepositInitiatedSubjectSchema>;

/**
 * Subject shape for WITHDRAWAL_INITIATED.
 * Emitted from the WithdrawalIntent DDB row (request-withdrawal.fn.js resolver in investor-bff).
 * Produced by the investor domain; forwarded to ExecutionBus by execution-adpt and
 * consumed by broker-ctrl to route withdrawals to the correct adapter (sim or alpaca).
 *
 * Owned here in the PRODUCER's cross-domain adapter (investor-adpt/domain) —
 * matching the ProposedTrade precedent. Breaks the broker-ctrl ↔ investor-bff
 * circular dependency.
 */
export const WithdrawalInitiatedSubjectSchema = z.object({
  withdrawalId: z.string(),
  amountCents: z.number().int().positive(),
  currency: z.string(),
  userId: z.string().optional(), // present; Cognito-supplied via stash
  tenantId: z.string(),
  region: z.string().optional(), // set from ctx.stash.region by the AppSync resolver
  status: z.string().optional(),
  requestedAt: z.string().optional(),
  timestamp: z.string(),
});
export type WithdrawalInitiatedSubject = z.infer<typeof WithdrawalInitiatedSubjectSchema>;
