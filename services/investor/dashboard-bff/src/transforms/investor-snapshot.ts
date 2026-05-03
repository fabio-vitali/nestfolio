import { project, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

/**
 * Materializes the InvestorSnapshot row from a composite InvestorProfile payload.
 *
 * Subscribes to INVESTOR_PROFILE_CREATED and INVESTOR_PROFILE_UPDATED. The CDC
 * publisher in investor-bff emits the entire InvestorProfile DynamoDB row as
 * the event subject — a composite payload containing goal, riskProfile,
 * mandate, operatingMode, etc. This transform reads the fields it cares about
 * with a single branch (no per-event-type switch).
 */
export const investorSnapshot = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): WriteIntent => {
  const { event } = uow;
  const { tenantId, userId, region } = event.context;
  const payload = event.subject as Record<string, unknown>;

  const goal = payload.goal as Record<string, unknown> | undefined;
  const riskProfile = payload.riskProfile as Record<string, unknown> | undefined;

  const updates: Record<string, unknown> = {
    tenantId,
    userId,
    region,
  };
  if (goal?.objective !== undefined) updates.goalType = goal.objective;
  if (riskProfile?.score !== undefined) updates.riskLevel = String(riskProfile.score);
  if (payload.operatingMode !== undefined) updates.operatingMode = payload.operatingMode;
  if (event.type === 'INVESTOR_PROFILE_CREATED') {
    updates.onboardedAt = event.timestamp;
  }

  return project('InvestorSnapshot', updates, {
    pk: `T#${tenantId}`,
    sk: 'InvestorSnapshot',
  });
};
