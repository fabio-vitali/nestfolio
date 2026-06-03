import { record, projectVersioned, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

type PositionRecord = {
  symbol: string;
  quantity: number;
  averageCostBasis: number;
  totalCostBasis: number;
  lastFillPrice: number;
};

type LedgerEntryPayload = {
  streamType?: string;
  lastEventSequence?: number;
  snapshot?: {
    positions: Record<string, PositionRecord>;
    cashBalanceCents: number;
    lastEventSequence: number;
  };
};

const HISTORY_SEQ_PAD = 8;

export const ledgerEntryRecorded = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>, Record<string, unknown>>>,
): WriteIntent | WriteIntent[] => {
  const { event } = uow;
  const { tenantId, userId, region } = event.context as {
    tenantId: string;
    userId?: string;
    region?: string;
  };
  const payload = event.subject as LedgerEntryPayload & Record<string, unknown>;

  const snapshot = payload.snapshot;
  const streamType = payload.streamType ?? 'actual';
  const sequenceNo = Number(snapshot?.lastEventSequence ?? payload.lastEventSequence ?? 0);
  const cashBalanceCents = snapshot?.cashBalanceCents ?? 0;
  const positions = snapshot?.positions ?? {};

  // Simulated stream: version-guarded projections fed from the snapshot. No
  // order-history / checkpoint rows — those describe the real account timeline.
  if (streamType === 'simulated') {
    const intents: WriteIntent[] = [
      projectVersioned('Simulation', {
        tenantId,
        userId,
        region,
        cashBalanceCents,
        positions,
      }, {
        version: sequenceNo,
        overrides: { pk: `Simulation#${tenantId}`, sk: 'Latest' },
      }),
    ];
    for (const [symbol, position] of Object.entries(positions)) {
      intents.push(
        projectVersioned('SimulationPosition', {
          tenantId,
          userId,
          region,
          symbol,
          quantity: position.quantity ?? 0,
          averageCostBasis: position.averageCostBasis ?? 0,
          totalCostBasis: position.totalCostBasis ?? 0,
          lastFillPrice: position.lastFillPrice ?? 0,
        }, {
          version: sequenceNo,
          overrides: { pk: `Simulation#${tenantId}`, sk: `Position#${symbol}` },
        }),
      );
    }
    return intents.length === 1 ? intents[0] : intents;
  }

  // Actual stream: append-only order history + one checkpoint per active date.
  // `eventId` and `createdAt` are auto-injected onto record() rows by the intent
  // executor (eventId = ctx.eventId, createdAt = ctx.timestamp) — not set here.
  const paddedSeq = String(sequenceNo).padStart(HISTORY_SEQ_PAD, '0');
  const date = event.timestamp.slice(0, 10);

  return [
    record('HistoryEntry', {
      tenantId,
      userId,
      region,
      eventType: event.type,
      sequenceNo,
      streamType,
      payload: { cashBalanceCents, positions, lastEventSequence: sequenceNo },
    }, {
      pk: `History#${tenantId}`,
      sk: paddedSeq,
    }),
    record('Checkpoint', {
      tenantId,
      userId,
      region,
      date,
      cashBalanceCents,
      positions,
    }, {
      pk: `Checkpoint#${tenantId}`,
      sk: date,
    }),
  ];
};
