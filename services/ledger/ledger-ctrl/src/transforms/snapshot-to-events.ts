import { record, type RecordIntent } from '@nestfolio/event-processor';

export interface SnapshotRecord {
  pk: string;
  sk: string;
  __typename: string;
  tenantId: string;
  streamType: string;
  timestamp: string;
  positions: Record<string, unknown>;
  cashBalanceCents: number;
  totalValueCents: number;
  positionCount?: number;
  lastEventSequence: number;
  version: number;
  snapshotAt: string;
  [key: string]: unknown;
}

export function snapshotToEvents(
  current: SnapshotRecord,
  previous: SnapshotRecord | undefined,
): RecordIntent[] {
  const { pk, streamType, timestamp, lastEventSequence } = current;
  const sk = (typename: string) => `${typename}#${timestamp}#${lastEventSequence}`;
  const overrides = (typename: string) => ({ pk, sk: sk(typename) });

  const snapshot = {
    positions: current.positions,
    cashBalanceCents: current.cashBalanceCents,
    lastEventSequence,
  };

  const balanceChanged = !previous || current.cashBalanceCents !== previous.cashBalanceCents;
  const positionsChanged = !previous || JSON.stringify(current.positions) !== JSON.stringify(previous.positions);

  const intents: RecordIntent[] = [];

  if (balanceChanged) {
    intents.push(record('BalanceEvent', {
      tenantId: current.tenantId,
      streamType,
      cashBalanceCents: current.cashBalanceCents,
      totalValueCents: current.totalValueCents,
      snapshot,
    }, overrides('BalanceEvent')));
  }

  if (positionsChanged) {
    intents.push(record('PortfolioEvent', {
      tenantId: current.tenantId,
      streamType,
      positions: current.positions,
      positionCount: Object.keys(current.positions).length,
      totalValueCents: current.totalValueCents,
      snapshot,
    }, overrides('PortfolioEvent')));
  }

  // LedgerEntryEvent — always emitted
  intents.push(record('LedgerEntryEvent', {
    tenantId: current.tenantId,
    streamType,
    lastEventSequence,
    snapshot,
  }, overrides('LedgerEntryEvent')));

  // SnapshotHistory — append-only with TTL
  intents.push(record('SnapshotHistory', {
    tenantId: current.tenantId,
    streamType,
    positions: current.positions,
    cashBalanceCents: current.cashBalanceCents,
    lastEventSequence,
    ttl: Math.floor(Date.now() / 1000) + (365 * 86400),
  }, { pk, sk: `SnapshotAt#${timestamp}` }));

  return intents;
}
