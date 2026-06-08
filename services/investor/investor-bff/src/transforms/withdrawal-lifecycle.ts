import { projectVersioned, parseSubject, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';
import { FundingSnapshotSchema } from '@nestfolio/execution-adpt/domain';

/**
 * WITHDRAWAL_REQUESTED / WITHDRAWAL_SETTLED / WITHDRAWAL_FAILED → WithdrawalRequest
 * P1 projection.
 *
 * Single-writer: broker-ctrl owns the funding lifecycle and emits versioned
 * snapshots (__version = status ordinal 1/3); investor-bff projects the
 * read-model row. `projectVersioned`'s guard drops a stale/replayed lower
 * version so a settled snapshot wins over a late requested one. Withdrawals have
 * no DETECTED step (no external arrival), so there is no `detectedAt`.
 *
 * Subject validated against broker-ctrl's FundingSnapshotSchema at runtime.
 */
export const withdrawalLifecycle = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>, Record<string, unknown>>>,
): WriteIntent => {
  const s = parseSubject(uow, FundingSnapshotSchema);
  const { tenantId, userId, region } = s;
  return projectVersioned(
    'WithdrawalRequest',
    {
      withdrawalId: s.transferId,
      amountCents: s.amountCents,
      currency: s.currency,
      status: s.status.toUpperCase(),
      requestedAt: s.initiatedAt,
      settledAt: s.settledAt ?? null,
      failedAt: s.failedAt ?? null,
      reason: s.reason ?? null,
      tenantId,
      userId,
      region,
    },
    {
      version: Number(s.__version),
      overrides: {
        pk: `InvestorProfile#${tenantId}#${userId}`,
        sk: `Withdrawal#${s.transferId}`,
      },
    },
  );
};
