import { project, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

export const investorSnapshot = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): WriteIntent => {
  const { event } = uow;
  const { tenantId, userId, region } = event.context;
  const payload = event.subject as Record<string, unknown>;

  const updates: Record<string, unknown> = { tenantId, userId, region };

  switch (event.type) {
    case 'GOAL_CREATED':
    case 'GOAL_UPDATED':
      updates.goalType = payload.objective;
      if (event.type === 'GOAL_CREATED') updates.onboardedAt = event.timestamp;
      break;

    case 'RISK_PROFILE_CREATED':
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
