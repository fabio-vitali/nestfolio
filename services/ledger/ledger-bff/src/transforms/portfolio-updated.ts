import { projectVersioned, record, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

type PositionRecord = {
  symbol: string;
  quantity: number;
  averageCostBasis: number;
  totalCostBasis: number;
  lastFillPrice: number;
};

type PortfolioPayload = {
  positions: Record<string, PositionRecord>;
  streamType?: string;
  snapshot?: {
    positions: Record<string, PositionRecord>;
    cashBalanceCents: number;
    lastEventSequence: number;
  };
};

export const portfolioUpdated = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>, Record<string, unknown>>>,
): WriteIntent | WriteIntent[] => {
  const { event } = uow;
  const { tenantId, userId, region } = event.context as {
    tenantId: string;
    userId?: string;
    region?: string;
  };
  const payload = event.subject as PortfolioPayload & Record<string, unknown>;

  const positions = payload.positions ?? {};
  const version = Number(payload.snapshot?.lastEventSequence ?? 0);
  const intents: WriteIntent[] = [];

  for (const [symbol, position] of Object.entries(positions)) {
    intents.push(
      projectVersioned('Position', {
        tenantId,
        userId,
        region,
        symbol,
        quantity: position.quantity ?? 0,
        averageCostBasis: position.averageCostBasis ?? 0,
        totalCostBasis: position.totalCostBasis ?? 0,
        lastFillPrice: position.lastFillPrice ?? 0,
      }, {
        version,
        overrides: { pk: `Portfolio#${tenantId}`, sk: `Position#${symbol}` },
      }),
    );
  }

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
