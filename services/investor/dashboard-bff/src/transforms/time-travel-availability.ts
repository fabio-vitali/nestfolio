import { projectVersioned, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

/**
 * Versioned P1 projection of TimeTravelAvailability from LEDGER_ENTRY_RECORDED.
 * Keyed on the ledger's monotonic `lastEventSequence` carried top-level on the
 * event subject. Returns undefined when it is absent (dropped, not written —
 * mirrors investor-snapshot.ts / advisory-status.ts).
 */
export const timeTravelAvailability = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): WriteIntent | undefined => {
  const { event } = uow;
  const { tenantId, userId, region } = event.context;
  const payload = event.subject as Record<string, unknown>;

  const version = payload.lastEventSequence;
  if (typeof version !== 'number') return undefined;

  const snapshotAt = (payload.snapshotAt as string) ?? event.timestamp;
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
