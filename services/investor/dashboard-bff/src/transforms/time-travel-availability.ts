import { projectVersioned, parseSubject, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';
import { LedgerEntryRecordedSchema } from '@nestfolio/ledger-ctrl/contracts';

/**
 * Versioned P1 projection of TimeTravelAvailability from LEDGER_ENTRY_RECORDED.
 * Keyed on the ledger's monotonic `lastEventSequence` carried top-level on the
 * event subject. The producer's contract guarantees `lastEventSequence` and
 * `snapshotAt`, so a contract violation throws (poison-pill → DLQ).
 */
export const timeTravelAvailability = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): WriteIntent | undefined => {
  const { event } = uow;
  const { tenantId, userId, region } = event.context;
  const payload = parseSubject(uow, LedgerEntryRecordedSchema);

  const version = payload.lastEventSequence;
  const snapshotAt = payload.snapshotAt;
  const latestDate = snapshotAt.slice(0, 10);

  return projectVersioned('TimeTravelAvailability', {
    tenantId,
    userId,
    region,
    available: true,
    snapshotAt,
    latestDate,
  }, {
    version,
    overrides: { pk: `T#${tenantId}`, sk: 'TimeTravelAvailability' },
  });
};
