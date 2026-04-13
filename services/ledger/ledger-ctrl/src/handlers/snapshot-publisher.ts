import { deriveFromStream, requireEnv } from '@nestfolio/event-processor';
import { snapshotToEvents, type SnapshotRecord } from '../transforms/snapshot-to-events';

requireEnv('TABLE_NAME');

export const handler = deriveFromStream({
  serviceName: 'ledger-ctrl',
  filter: (record) => record.__typename === 'AccountSnapshot',
  transform: (current, previous) =>
    snapshotToEvents(current as unknown as SnapshotRecord, previous as unknown as SnapshotRecord | undefined),
  errorEventType: 'LEDGER_SNAPSHOT_PUBLISHER_FAILED',
});
