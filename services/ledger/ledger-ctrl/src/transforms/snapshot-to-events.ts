import { record, type RecordIntent } from '@nestfolio/event-processor';
import type { RequestContext, TableEntry } from '@nestfolio/event-processor';
import type {
  AccountSnapshot, BalanceUpdated, PortfolioUpdated, LedgerEntryRecorded, SnapshotHistory, LedgerSnapshot,
} from '../domain/contracts';

/** The persisted AccountSnapshot row (DDB-stream image). */
export type SnapshotRecord = TableEntry<AccountSnapshot, RequestContext>;

export function snapshotToEvents(
  current: SnapshotRecord,
  previous: SnapshotRecord | undefined,
): RecordIntent[] {
  const { pk, streamType, timestamp, lastEventSequence } = current;
  const sk = (typename: string) => `${typename}#${timestamp}#${lastEventSequence}`;
  const overrides = (typename: string) => ({ pk, sk: sk(typename) });

  const snapshot: LedgerSnapshot = {
    positions: current.positions,
    cashBalanceCents: current.cashBalanceCents,
    lastEventSequence,
  };

  const balanceChanged = !previous || current.cashBalanceCents !== previous.cashBalanceCents;
  const positionsChanged = !previous || JSON.stringify(current.positions) !== JSON.stringify(previous.positions);

  const intents: RecordIntent[] = [];

  if (balanceChanged) {
    const subject: BalanceUpdated = {
      streamType,
      cashBalanceCents: current.cashBalanceCents,
      totalValueCents: current.totalValueCents,
      snapshot,
    };
    intents.push(record('BalanceEvent', { tenantId: current.tenantId, ...subject }, overrides('BalanceEvent')));
  }

  if (positionsChanged) {
    const subject: PortfolioUpdated = {
      streamType,
      positions: current.positions,
      positionCount: Object.keys(current.positions).length,
      totalValueCents: current.totalValueCents,
      snapshot,
    };
    intents.push(record('PortfolioEvent', { tenantId: current.tenantId, ...subject }, overrides('PortfolioEvent')));
  }

  const ledgerEntry: LedgerEntryRecorded = {
    streamType,
    lastEventSequence,
    snapshotAt: current.snapshotAt,
    snapshot,
  };
  intents.push(record('LedgerEntryEvent', { tenantId: current.tenantId, ...ledgerEntry }, overrides('LedgerEntryEvent')));

  const history: SnapshotHistory = {
    streamType,
    positions: current.positions,
    cashBalanceCents: current.cashBalanceCents,
    lastEventSequence,
  };
  intents.push(record(
    'SnapshotHistory',
    { tenantId: current.tenantId, ...history, ttl: Math.floor(Date.now() / 1000) + (365 * 86400) },
    { pk, sk: `SnapshotAt#${timestamp}` },
  ));

  return intents;
}
