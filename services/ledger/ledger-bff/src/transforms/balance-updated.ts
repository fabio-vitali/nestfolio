import { projectVersioned, record, parseSubject, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';
import { BalanceUpdatedSubjectSchema } from '@nestfolio/ledger-ctrl/contracts';

export const balanceUpdated = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>, Record<string, unknown>>>,
): WriteIntent | WriteIntent[] => {
  const { event } = uow;
  const { tenantId, userId, region } = event.context as {
    tenantId: string;
    userId?: string;
    region?: string;
  };
  const payload = parseSubject(uow, BalanceUpdatedSubjectSchema);

  const balanceCents = payload.cashBalanceCents;
  const version = Number(payload.snapshot.lastEventSequence);

  const streamType = payload.streamType ?? 'actual';

  return [
    projectVersioned('PortfolioLatest', {
      tenantId,
      userId,
      region,
      cashBalanceCents: balanceCents,
    }, {
      version,
      overrides: { pk: `Portfolio#${tenantId}`, sk: 'Latest' },
    }),
    record('SnapshotAt', {
      tenantId,
      userId,
      region,
      streamType,
      snapshotAt: event.timestamp,
      cashBalanceCents: payload.snapshot.cashBalanceCents,
      positions: payload.snapshot.positions,
    }, {
      pk: `SnapshotAt#${tenantId}#${streamType}`,
      sk: event.timestamp,
    }),
  ];
};
