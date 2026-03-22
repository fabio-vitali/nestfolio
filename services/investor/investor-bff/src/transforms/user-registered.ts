import { record, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

type UserRegisteredPayload = {
  userId: string;
  tenantId: string;
  email: string;
};

export const userRegistered = (
  uow: UnitOfWork<BusEvent<UserRegisteredPayload>>,
): WriteIntent =>
  record('InvestorProfile', {
    tenantId: uow.event.subject.tenantId,
    userId: uow.event.subject.userId,
    email: uow.event.subject.email,
  });
