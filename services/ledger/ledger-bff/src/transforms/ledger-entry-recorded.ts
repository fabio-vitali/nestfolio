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
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  timestamp: string;
  sequenceNo: number;
  streamType?: string;
  // Top-level fields consumed by the P2 append-logs (HistoryEntry / Checkpoint).
  // These predate w1 and are left untouched — the broader producer-shape mismatch
  // (the real LedgerEntryEvent carries these only inside `snapshot`) is filed as
  // ledger-entry-recorded-producer-shape-mismatch, out of w1 scope.
  cashBalanceCents?: number;
  positions?: Record<string, PositionRecord>;
  snapshot?: {
    positions: Record<string, PositionRecord>;
    cashBalanceCents: number;
    lastEventSequence: number;
  };
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

  // Simulated stream: version-guarded projections fed from the snapshot.
  if (payload.streamType === 'simulated') {
    const snapshot = payload.snapshot;
    const cashBalanceCents = snapshot?.cashBalanceCents ?? 0;
    const positions = snapshot?.positions ?? {};
    const version = Number(snapshot?.lastEventSequence ?? 0);

    intents.push(
      projectVersioned('Simulation', {
        tenantId,
        userId,
        region,
        cashBalanceCents,
        positions,
      }, {
        version,
        overrides: { pk: `Simulation#${tenantId}`, sk: 'Latest' },
      }),
    );

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
          version,
          overrides: { pk: `Simulation#${tenantId}`, sk: `Position#${symbol}` },
        }),
      );
    }
  }

  // Checkpoint every N entries (append-only).
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
