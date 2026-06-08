import { projectVersioned, parseSubject, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';
import { FundingSnapshotSchema } from '@nestfolio/execution-adpt/domain';

/**
 * DEPOSIT_DETECTED / DEPOSIT_SETTLED / DEPOSIT_FAILED (and the DEPOSIT_REQUESTED
 * carrier) → Deposit P1 projection.
 *
 * Single-writer: broker-ctrl owns the funding lifecycle and emits versioned
 * snapshots (__version = status ordinal 1/2/3); investor-bff projects the
 * read-model row. `projectVersioned`'s guard drops a stale/replayed lower
 * version so a settled (v3) snapshot wins over a late detected (v2).
 *
 * Subject validated against broker-ctrl's FundingSnapshotSchema at runtime.
 */
export const depositLifecycle = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): WriteIntent => {
  const s = parseSubject(uow, FundingSnapshotSchema);
  const { tenantId, userId, region } = uow.event.context;
  return projectVersioned(
    'Deposit',
    {
      depositId: s.transferId,
      amountCents: s.amountCents,
      currency: s.currency,
      status: s.status.toUpperCase(),
      initiatedAt: s.initiatedAt,
      detectedAt: s.detectedAt ?? null,
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
        sk: `Deposit#${s.transferId}`,
      },
    },
  );
};
