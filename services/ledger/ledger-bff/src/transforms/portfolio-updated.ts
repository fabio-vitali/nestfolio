import { projectVersioned, record, parseSubject, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';
import { PortfolioUpdatedSchema } from '@nestfolio/ledger-ctrl/contracts';

export const portfolioUpdated = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>, Record<string, unknown>>>,
): WriteIntent | WriteIntent[] => {
  const { event } = uow;
  const { tenantId, userId, region } = event.context as {
    tenantId: string;
    userId?: string;
    region?: string;
  };
  const payload = parseSubject(uow, PortfolioUpdatedSchema);

  const positions = payload.positions;
  const version = Number(payload.snapshot.lastEventSequence);
  const streamType = payload.streamType ?? 'actual';

  const intents: WriteIntent[] = [];

  for (const [symbol, position] of Object.entries(positions)) {
    intents.push(
      projectVersioned('Position', {
        tenantId,
        userId,
        region,
        symbol,
        quantity: position.quantity,
        averageCostBasis: position.averageCostBasis,
        totalCostBasis: position.totalCostBasis,
        lastFillPrice: position.lastFillPrice,
      }, {
        version,
        overrides: { pk: `Portfolio#${tenantId}`, sk: `Position#${symbol}` },
      }),
    );
  }

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

  return intents.length === 1 ? intents[0] : intents;
};
