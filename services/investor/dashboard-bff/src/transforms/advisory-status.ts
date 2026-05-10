import { accumulate, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

const TRIGGER_TYPES = new Set<string>([
  'ADVISORY_PIPELINE_READY',
  'INVESTOR_PROFILE_UPDATED',
  'PORTFOLIO_DRIFT_DETECTED',
  'ORDER_FILLED',
  'ORDER_REJECTED',
  'ORDER_CANCELLED',
  'DEPOSIT_DETECTED',
]);

export const advisoryStatus = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): WriteIntent | undefined => {
  const { event } = uow;
  const { tenantId } = event.context;
  const overrides = { pk: `T#${tenantId}`, sk: 'AdvisoryStatus' };

  if (TRIGGER_TYPES.has(event.type)) {
    return accumulate('AdvisoryStatus', { field: 'pendingDecisionsCount', increment: 1, overrides });
  }

  switch (event.type) {
    case 'DECISION_APPROVED':
    case 'DECISION_BLOCKED':
      return accumulate('AdvisoryStatus', { field: 'pendingDecisionsCount', increment: -1, overrides });
    default:
      return undefined;
  }
};
