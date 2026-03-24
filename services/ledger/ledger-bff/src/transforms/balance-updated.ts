import { update, project, type WriteIntent } from '@nestfolio/event-processor';
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

  const intents: WriteIntent[] = [
    project('PortfolioBalance', {
      tenantId,
      userId,
      region,
      cashBalanceCents: balanceCents,
    }, {
      pk: `Portfolio#${tenantId}`,
      sk: 'Balance',
    }),
  ];

  if (payload.snapshot) {
    const streamType = payload.streamType ?? 'actual';
    intents.push(
      project('SnapshotAt', {
        tenantId,
        userId,
        region,
        streamType,
        snapshotAt: event.timestamp,
        cashBalanceCents: payload.snapshot.cashBalanceCents,
        positions: payload.snapshot.positions,
      }, {
        pk: `SnapshotAt#${tenantId}#${streamType}`,
        sk: `SnapshotAt#${event.timestamp}`,
      }),
    );
  }

  return intents.length === 1 ? intents[0] : intents;
};
