import { projectVersioned, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

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
 * Subject shape is broker-ctrl's funding snapshot — declared locally because the
 * source type lives in broker-ctrl, not investor-bff.
 */
interface FundingSnapshot {
  status: string;
  transferId: string;
  amountCents: number;
  currency: string;
  initiatedAt: string;
  settledAt?: string;
  failedAt?: string;
  reason?: string;
  __version: number;
}

interface FundingContext {
  tenantId: string;
  userId: string;
  region: string;
}

export const withdrawalLifecycle = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>, Record<string, unknown>>>,
): WriteIntent => {
  const s = uow.event.subject as FundingSnapshot;
  const { tenantId, userId, region } = uow.event.context as FundingContext;
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
