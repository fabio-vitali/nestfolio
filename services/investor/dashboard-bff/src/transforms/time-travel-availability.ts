import { project, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

export const timeTravelAvailability = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): WriteIntent => {
  const { event } = uow;
  const tenantId = (event.context as Record<string, string>).tenantId;
  const payload = event.subject as Record<string, unknown>;
  const snapshotAt = (payload.snapshotAt as string) ?? event.timestamp;

  return project('TimeTravelAvailability', {
    tenantId,
    snapshotAt,
  }, {
    pk: `T#${tenantId}`,
    sk: 'TimeTravelAvailability',
  });
};
