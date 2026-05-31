import { projectVersioned, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

interface BalanceUpdatedPayload {
  tenantId: string;
  userId: string;
  cashBalanceCents: number;
  // Ledger stamps a monotonic sequence on the snapshot it emits with
  // BALANCE_UPDATED; we version-guard the CashBalance projection on it so a
  // late/duplicate ledger event can never clobber a newer balance.
  snapshot?: { lastEventSequence: number };
}

export const balanceUpdated = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>, Record<string, unknown>>>,
): WriteIntent => {
  const s = uow.event.subject as BalanceUpdatedPayload;
  const version = Number(s.snapshot?.lastEventSequence ?? 0);
  return projectVersioned('CashBalance', {
    tenantId: s.tenantId,
    userId: s.userId,
    cashBalanceCents: s.cashBalanceCents,
  }, {
    version,
    overrides: { pk: `InvestorProfile#${s.tenantId}#${s.userId}`, sk: 'CashBalance' },
  });
};
