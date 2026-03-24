import { project, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

export const investorSnapshot = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): WriteIntent => {
  const { event } = uow;
  const tenantId = (event.context as Record<string, string>).tenantId;
  const payload = event.subject as Record<string, unknown>;

  const updates: Record<string, unknown> = { tenantId };

  switch (event.type) {
    case 'GOAL_SET':
    case 'GOAL_UPDATED':
      updates.goalType = payload.objective;
      if (event.type === 'GOAL_SET') updates.onboardedAt = event.timestamp;
      break;

    case 'RISK_PROFILE_SET':
    case 'RISK_PROFILE_UPDATED':
      updates.riskLevel = String(payload.score ?? '');
      break;

    case 'OPERATING_MODE_SELECTED':
    case 'OPERATING_MODE_CHANGED':
      updates.operatingMode = payload.mode;
      break;

    default:
      break;
  }

  return project('InvestorSnapshot', updates, {
    pk: `T#${tenantId}`,
    sk: 'InvestorSnapshot',
  });
};
