import { record, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

interface UserRegisteredPayload {
  userId: string;
  tenantId: string;
  email: string;
}

export const userRegistered = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>, Record<string, unknown>>>,
): WriteIntent => {
  const s = uow.event.subject as UserRegisteredPayload;
  return record('InvestorProfile', {
    tenantId: s.tenantId,
    userId: s.userId,
    email: s.email,
  });
};
