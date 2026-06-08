import { projectVersioned, parseSubject, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';
import { BalanceUpdatedSchema } from '@nestfolio/ledger-ctrl/contracts';

export const balanceUpdated = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): WriteIntent => {
  const s = parseSubject(uow, BalanceUpdatedSchema);
  const { tenantId, userId } = uow.event.context;
  const version = Number(s.snapshot.lastEventSequence);
  return projectVersioned('CashBalance', {
    tenantId,
    userId,
    cashBalanceCents: s.cashBalanceCents,
  }, {
    version,
    overrides: { pk: `InvestorProfile#${tenantId}#${userId}`, sk: 'CashBalance' },
  });
};
