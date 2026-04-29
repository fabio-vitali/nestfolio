import { record, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

interface UserRegisteredPayload {
  userId: string;
  tenantId: string;
  email: string;
}

/**
 * Creates the InvestorProfile row if it does not yet exist.
 *
 * Uses `record()` (attribute_not_exists guard, dedup-on-conflict) instead of
 * `project()` (unconditional Put). When ONBOARDING_COMPLETED arrives before
 * USER_REGISTERED, the onboarding handler atomically Puts a complete
 * InvestorProfile (including email it carries on its subject); USER_REGISTERED
 * then becomes a no-op and must NOT clobber the richer row with a bare
 * `{tenantId,userId,email}` shape. See
 * `services/investor/investor-bff/src/transforms/onboarding-completed.ts`
 * for the atomic-Put rationale.
 */
export const userRegistered = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>, Record<string, unknown>>>,
): WriteIntent => {
  const s = uow.event.subject as UserRegisteredPayload;
  return record('InvestorProfile', {
    tenantId: s.tenantId,
    userId: s.userId,
    email: s.email,
  }, {
    pk: `InvestorProfile#${s.tenantId}#${s.userId}`,
    sk: 'InvestorProfile',
  });
};
