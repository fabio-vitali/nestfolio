import { deriveFromStream, requireEnv } from '@nestfolio/event-processor';
import { snapshotToEvents, type SnapshotRecord } from '../transforms/snapshot-to-events';

requireEnv('TABLE_NAME');

export const handler = deriveFromStream({
  serviceName: 'ledger-ctrl',
  filter: (record) => record.__typename === 'AccountSnapshot',
  transform: (current, previous) =>
    // Raw DDB stream image — cast to the typed row shape. Proper parse/validation of the
    // stream row is deferred to WS-2 (cdc-publisher-typed-subjects).
    snapshotToEvents(current as unknown as SnapshotRecord, previous as unknown as SnapshotRecord | undefined),
  errorEventType: 'LEDGER_SNAPSHOT_PUBLISHER_FAILED',
});
