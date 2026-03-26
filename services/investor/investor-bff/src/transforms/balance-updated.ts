import { project, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

interface BalanceUpdatedPayload {
  tenantId: string;
  userId: string;
  cashBalanceCents: number;
}

export const balanceUpdated = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>, Record<string, unknown>>>,
): WriteIntent => {
  const s = uow.event.subject as BalanceUpdatedPayload;
  return project('CashBalance', {
    tenantId: s.tenantId,
    userId: s.userId,
    cashBalanceCents: s.cashBalanceCents,
  }, {
    pk: `InvestorProfile#${s.tenantId}#${s.userId}`,
    sk: 'CashBalance',
  });
};
