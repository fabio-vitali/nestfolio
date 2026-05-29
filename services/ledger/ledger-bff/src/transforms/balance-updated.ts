import { projectVersioned, record, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

type BalancePayload = {
  cashBalanceCents: number;
  deltaCents: number;
  streamType?: string;
  snapshot?: {
    positions: Record<string, unknown>;
    cashBalanceCents: number;
    lastEventSequence: number;
  };
};

export const balanceUpdated = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): WriteIntent | WriteIntent[] => {
  const { event } = uow;
  const { tenantId, userId, region } = event.context;
  const payload = event.subject as BalancePayload & Record<string, unknown>;

  const balanceCents = payload.cashBalanceCents ?? 0;
  const version = Number(payload.snapshot?.lastEventSequence ?? 0);

  const intents: WriteIntent[] = [
    projectVersioned('PortfolioLatest', {
      tenantId,
      userId,
      region,
      cashBalanceCents: balanceCents,
    }, {
      version,
      overrides: { pk: `Portfolio#${tenantId}`, sk: 'Latest' },
    }),
  ];

  if (payload.snapshot) {
    const streamType = payload.streamType ?? 'actual';
    intents.push(
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
    );
  }

  return intents.length === 1 ? intents[0] : intents;
};
