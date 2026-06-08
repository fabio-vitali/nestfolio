import { projectVersioned, parseSubject, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';
import { InvestorProfileUpdatedSchema } from '@nestfolio/investor-bff/contracts';

/**
 * Versioned P1 projection of the InvestorSnapshot row from the composite
 * InvestorProfile payload (workstream 4).
 *
 * Subscribes to INVESTOR_PROFILE_CREATED and INVESTOR_PROFILE_UPDATED. The CDC
 * publisher in investor-bff emits the entire InvestorProfile row as the event
 * subject — including the producer-stamped monotonic `__version` and the stable
 * `onboardingCompletedAt`. We version-guard on `__version` (a late/duplicate
 * INVESTOR_PROFILE_* event can never clobber newer state) and read `onboardedAt`
 * from the always-present payload field so a full-row write never wipes it.
 *
 * Returns undefined when `__version` is absent (a producer that has not adopted
 * versioning yet) — dropped, not written, mirroring advisory-status.ts.
 */
export const investorSnapshot = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): WriteIntent | undefined => {
  const { event } = uow;
  const { tenantId, userId, region } = event.context;
  const payload = parseSubject(uow, InvestorProfileUpdatedSchema);

  const version = payload.__version;
  if (typeof version !== 'number') return undefined;

  const { goal, riskProfile } = payload;

  const fields: Record<string, unknown> = {
    tenantId,
    userId,
    region,
  };
  if (goal?.objective !== undefined) fields.goalType = goal.objective;
  if (riskProfile?.score !== undefined) fields.riskLevel = String(riskProfile.score);
  if (payload.operatingMode !== undefined) fields.operatingMode = payload.operatingMode;
  if (payload.onboardingCompletedAt !== undefined) fields.onboardedAt = payload.onboardingCompletedAt;

  return projectVersioned('InvestorSnapshot', fields, {
    version,
    overrides: { pk: `T#${tenantId}`, sk: 'InvestorSnapshot' },
  });
};
