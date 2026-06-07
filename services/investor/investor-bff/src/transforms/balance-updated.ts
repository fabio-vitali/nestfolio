import { projectVersioned, parseSubject, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';
import { BalanceUpdatedSubjectSchema } from '@nestfolio/ledger-ctrl/contracts';

export const balanceUpdated = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>, Record<string, unknown>>>,
): WriteIntent => {
  const s = parseSubject(uow as UnitOfWork<BusEvent<unknown>>, BalanceUpdatedSubjectSchema);
  const version = Number(s.snapshot.lastEventSequence);
  return projectVersioned('CashBalance', {
    tenantId: s.tenantId,
    userId: s.userId,
    cashBalanceCents: s.cashBalanceCents,
  }, {
    version,
    overrides: { pk: `InvestorProfile#${s.tenantId}#${s.userId}`, sk: 'CashBalance' },
  });
};
