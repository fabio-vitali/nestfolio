import { project, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

type BalanceUpdatedPayload = {
  tenantId: string;
  userId: string;
  cashBalanceCents: number;
};

export const balanceUpdated = (
  uow: UnitOfWork<BusEvent<BalanceUpdatedPayload>>,
): WriteIntent =>
  project('CashBalance', {
    tenantId: uow.event.subject.tenantId,
    userId: uow.event.subject.userId,
    cashBalanceCents: uow.event.subject.cashBalanceCents,
  }, {
    pk: `InvestorProfile#${uow.event.subject.tenantId}#${uow.event.subject.userId}`,
    sk: 'CashBalance',
  });
