import { skip, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

/**
 * USER_REGISTERED is observed for cross-service propagation but does NOT
 * pre-create an InvestorProfile row. Onboarding (`onboarding-completed.ts`)
 * is the sole writer of the composite InvestorProfile row — pre-writing here
 * would race with onboarding's Put and surface as INVESTOR_PROFILE_UPDATED
 * (MODIFY) instead of INVESTOR_PROFILE_CREATED (INSERT) in CDC.
 */
export const userRegistered = (
  _uow: UnitOfWork<BusEvent<Record<string, unknown>, Record<string, unknown>>>,
): WriteIntent => skip();
