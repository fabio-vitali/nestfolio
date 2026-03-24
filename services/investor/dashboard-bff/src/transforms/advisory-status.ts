import { accumulate, update, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

export const advisoryStatus = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): WriteIntent | undefined => {
  const { event } = uow;
  const { tenantId, userId, region } = event.context;
  const overrides = { pk: `T#${tenantId}`, sk: 'AdvisoryStatus' };

  switch (event.type) {
    case 'DECISION_PACKET_CREATED':
    case 'USER_CONFIRMATION_REQUESTED':
      return accumulate('AdvisoryStatus', {
        field: 'pendingDecisions',
        increment: 1,
        overrides,
      });

    case 'DECISION_APPROVED':
      return accumulate('AdvisoryStatus', {
        field: 'pendingDecisions',
        increment: -1,
        overrides,
      });

    case 'DECISION_BLOCKED':
      return accumulate('AdvisoryStatus', {
        field: 'pendingDecisions',
        increment: -1,
        overrides,
      });

    default:
      return undefined;
  }
};
