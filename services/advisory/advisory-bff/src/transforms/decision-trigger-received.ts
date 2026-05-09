import { accumulate, update, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

export const decisionTriggerReceived = (
  uow: UnitOfWork<BusEvent<{ tenantId: string }>>,
): WriteIntent[] => {
  const { tenantId } = uow.event.context;
  const overrides = { pk: `T#${tenantId}`, sk: 'AdvisoryStatus' };
  return [
    accumulate('AdvisoryStatus', {
      field: 'inFlightCount',
      increment: 1,
      overrides,
    }),
    update('AdvisoryStatus', {
      lastTriggerAt: uow.event.timestamp,
      updatedAt: uow.event.timestamp,
    }, { overrides }),
  ];
};
