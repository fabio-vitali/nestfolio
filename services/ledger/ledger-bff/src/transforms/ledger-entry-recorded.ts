import { record, project, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

type PositionRecord = {
  symbol: string;
  quantity: number;
  averageCostBasis: number;
  totalCostBasis: number;
  lastFillPrice: number;
};

type LedgerEntryPayload = {
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  timestamp: string;
  sequenceNo: number;
  streamType?: string;
  cashBalanceCents?: number;
  positions?: Record<string, PositionRecord>;
};

const CHECKPOINT_INTERVAL = 100;

export const ledgerEntryRecorded = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): WriteIntent | WriteIntent[] => {
  const { event } = uow;
  const { tenantId, userId, region } = event.context;
  const payload = event.subject as LedgerEntryPayload & Record<string, unknown>;

  const intents: WriteIntent[] = [
    record('HistoryEntry', {
      tenantId,
      userId,
      region,
      eventId: payload.eventId,
      eventType: payload.eventType,
      payload: payload.payload ?? {},
      createdAt: payload.timestamp,
      sequenceNo: payload.sequenceNo,
      streamType: payload.streamType,
    }, {
      pk: `History#${tenantId}`,
      sk: `Entry#${payload.sequenceNo}`,
    }),
  ];

  // Simulated stream: update simulation projections
  if (payload.streamType === 'simulated') {
    const cashBalanceCents = payload.cashBalanceCents ?? 0;
    const positions = payload.positions ?? {};

    intents.push(
      project('Simulation', {
        tenantId,
        userId,
        region,
        cashBalanceCents,
        positions,
      }, {
        pk: `Simulation#${tenantId}`,
        sk: 'Latest',
      }),
    );

    for (const [symbol, position] of Object.entries(positions)) {
      intents.push(
        project('SimulationPosition', {
          tenantId,
          userId,
          region,
          symbol,
          quantity: position.quantity ?? 0,
          averageCostBasis: position.averageCostBasis ?? 0,
          totalCostBasis: position.totalCostBasis ?? 0,
          lastFillPrice: position.lastFillPrice ?? 0,
        }, {
          pk: `Simulation#${tenantId}`,
          sk: `Position#${symbol}`,
        }),
      );
    }
  }

  // Checkpoint every N entries
  if (payload.sequenceNo > 0 && payload.sequenceNo % CHECKPOINT_INTERVAL === 0) {
    const date = payload.timestamp.slice(0, 10);
    intents.push(
      record('Checkpoint', {
        tenantId,
        userId,
        region,
        date,
        cashBalanceCents: payload.cashBalanceCents ?? 0,
        positions: payload.positions ?? {},
      }, {
        pk: `Checkpoint#${tenantId}`,
        sk: date,
      }),
    );
  }

  return intents.length === 1 ? intents[0] : intents;
};
