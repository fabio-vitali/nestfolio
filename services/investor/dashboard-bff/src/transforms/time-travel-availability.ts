import { project, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

export const timeTravelAvailability = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): WriteIntent => {
  const { event } = uow;
  const { tenantId, userId, region } = event.context;
  const payload = event.subject as Record<string, unknown>;
  const snapshotAt = (payload.snapshotAt as string) ?? event.timestamp;

  const date = snapshotAt.slice(0, 10);

  return project('TimeTravelAvailability', {
    tenantId,
    userId,
    region,
    available: true,
    snapshotAt,
    latestDate: date,
  }, {
    pk: `T#${tenantId}`,
    sk: 'TimeTravelAvailability',
  });
};
