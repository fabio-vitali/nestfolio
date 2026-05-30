import { projectVersioned, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

type LedgerPosition = { quantity?: number; lastFillPrice?: number };
type LedgerSnapshot = {
  cashBalanceCents?: number;
  positions?: Record<string, LedgerPosition>;
  lastEventSequence?: number;
};

/**
 * Projects the PortfolioSummary read row from the authoritative ledger snapshot
 * carried on BALANCE_UPDATED / PORTFOLIO_UPDATED. Full-row, version-guarded write
 * keyed on `lastEventSequence` — fixes the cashBalanceCents/positionCount
 * structural zeros and the totalValueCents double-count by construction (no more
 * `accumulate`). Position values are dollar-denominated in the snapshot, so
 * market value is computed here. See docs/architecture/READ-MODEL-OWNERSHIP.md.
 */
export const portfolioSummary = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): WriteIntent | undefined => {
  const { event } = uow;
  const { tenantId, userId, region } = event.context;
  const subject = event.subject as Record<string, unknown>;
  const snapshot = (subject?.snapshot ?? subject) as LedgerSnapshot | undefined;

  if (!snapshot || snapshot.cashBalanceCents === undefined) return undefined;

  const positions = snapshot.positions ?? {};
  const positionMarketValueCents = Object.values(positions).reduce(
    (sum, p) => sum + Math.round((p.quantity ?? 0) * (p.lastFillPrice ?? 0) * 100),
    0,
  );

  return projectVersioned(
    'PortfolioSummary',
    {
      tenantId,
      userId,
      region,
      cashBalanceCents: snapshot.cashBalanceCents,
      positionCount: Object.keys(positions).length,
      totalValueCents: snapshot.cashBalanceCents + positionMarketValueCents,
    },
    {
      version: Number(snapshot.lastEventSequence ?? 0),
      overrides: { pk: `T#${tenantId}`, sk: 'PortfolioSummary' },
    },
  );
};
