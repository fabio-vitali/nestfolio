import { z } from 'zod';
import type { ZodTypeAny } from 'zod';

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
export const DepositInitiatedSchema = z.object({
  depositId: z.string(),
  amountCents: z.number().int().positive(),
  currency: z.string(),
  status: z.string().optional(),
  initiatedAt: z.string().optional(),
  timestamp: z.string(),
});
export type DepositInitiated = z.infer<typeof DepositInitiatedSchema>;

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
export const WithdrawalInitiatedSchema = z.object({
  withdrawalId: z.string(),
  amountCents: z.number().int().positive(),
  currency: z.string(),
  status: z.string().optional(),
  requestedAt: z.string().optional(),
  timestamp: z.string(),
});
export type WithdrawalInitiated = z.infer<typeof WithdrawalInitiatedSchema>;

/**
 * Subject shape for MANDATE_ISSUED / MANDATE_REVOKED / OPERATING_MODE_CHANGED.
 * One aggregate, three event names — the whole Mandate sibling row (sk='Mandate',
 * investor-bff transforms/onboarding-completed.ts + revokeMandate/updateOperatingMode
 * resolvers) is CDC-emitted as the subject. OPERATING_MODE_CHANGED is re-sourced from
 * this row's operatingMode field (onFieldChange), so operatingMode is a Mandate field.
 *
 * Owned here in the PRODUCER's cross-domain adapter (investor-adpt/domain) — investor
 * produces it; compliance-ctrl (advisory domain) consumes it. Matches the
 * DepositInitiated / ProposedTrade precedent. Dry subject — identity travels in the
 * event context (RequestContext), not here.
 */
export const MandateSchema = z.object({
  mandateId: z.string(),
  level: z.enum(['ADVISORY', 'DISCRETIONARY']),
  status: z.enum(['ACTIVE', 'REVOKED']),
  operatingMode: z.enum(['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE']),
  effectiveDate: z.string(),
  revokedAt: z.string().nullable().optional(),
  __version: z.number().optional(),
});
export type Mandate = z.infer<typeof MandateSchema>;

/**
 * Subject shape for EXECUTION_MODE_CHANGED / EXECUTION_MODE_CHANGE_UPDATED.
 * The ExecutionModeChange audit row (investor-bff investor-profile.repository.ts
 * setExecutionMode). Owned here — broker-ctrl (execution domain) consumes
 * EXECUTION_MODE_CHANGED. Dry subject — identity travels in the event context.
 */
export const ExecutionModeChangedSchema = z.object({
  changeId: z.string(),
  fromMode: z.enum(['simulation', 'live']),
  toMode: z.enum(['simulation', 'live']),
  changedAt: z.string(),
});
export type ExecutionModeChanged = z.infer<typeof ExecutionModeChangedSchema>;

/**
 * Test-fixture event→subject map for the Mandate aggregate. One aggregate, four
 * event names, all carrying the full Mandate image (MandateSchema). Co-located with
 * the producer-owned contract (single source of truth) and consumed only by the
 * typed-fixture registry (`@nestfolio/test-contracts`). Bare string-literal keys so
 * `keyof typeof` is a literal union.
 */
export const mandateEventSubjects = {
  MANDATE_ISSUED: MandateSchema,
  OPERATING_MODE_CHANGED: MandateSchema,
  MANDATE_REVOKED: MandateSchema,
  MANDATE_REAFFIRMED: MandateSchema,
} as const satisfies Record<string, ZodTypeAny>;

/**
 * Test-fixture event→subject map for the investor-produced, cross-domain-consumed
 * funding / execution-mode events whose contracts live here (the producer-adapter home).
 * MANDATE_* lives in mandateEventSubjects (above). Consumed only by @nestfolio/test-contracts.
 */
export const investorFundingEventSubjects = {
  DEPOSIT_INITIATED: DepositInitiatedSchema,
  WITHDRAWAL_INITIATED: WithdrawalInitiatedSchema,
  EXECUTION_MODE_CHANGED: ExecutionModeChangedSchema,
  EXECUTION_MODE_CHANGE_UPDATED: ExecutionModeChangedSchema,
} as const satisfies Record<string, ZodTypeAny>;
