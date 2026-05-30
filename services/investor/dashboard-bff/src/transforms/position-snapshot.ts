import { projectVersioned, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

type LedgerPosition = {
  symbol?: string;
  quantity?: number;
  averageCostBasis?: number;
  totalCostBasis?: number;
  lastFillPrice?: number;
};
type LedgerSnapshot = { positions?: Record<string, LedgerPosition>; lastEventSequence?: number };

/**
 * Projects one PositionSnapshot row per holding from the authoritative ledger
 * snapshot. Full-row, version-guarded writes keyed on `lastEventSequence`.
 * Snapshot positions are dollar-denominated, so cents/market-value are computed
 * here; `assetClass` defaults to EQUITY (absent from the snapshot) and
 * `weightPercent` is each holding's share of total market value.
 * See docs/architecture/READ-MODEL-OWNERSHIP.md.
 */
export const positionSnapshot = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): WriteIntent[] => {
  const { event } = uow;
  const { tenantId, userId, region } = event.context;
  const subject = event.subject as Record<string, unknown>;
  const snapshot = (subject?.snapshot ?? subject) as LedgerSnapshot | undefined;
  const entries = Object.entries(snapshot?.positions ?? {});
  if (entries.length === 0) return [];

  const version = Number(snapshot?.lastEventSequence ?? 0);
  const marketValueCentsOf = (p: LedgerPosition) =>
    Math.round((p.quantity ?? 0) * (p.lastFillPrice ?? 0) * 100);
  const totalMarketValueCents = entries.reduce((sum, [, p]) => sum + marketValueCentsOf(p), 0);

  return entries.map(([key, pos]) => {
    const symbol = pos.symbol ?? key;
    const marketValueCents = marketValueCentsOf(pos);
    return projectVersioned(
      'PositionSnapshot',
      {
        tenantId,
        userId,
        region,
        symbol,
        assetClass: 'EQUITY',
        quantity: pos.quantity ?? 0,
        avgCostBasisCents: Math.round((pos.averageCostBasis ?? 0) * 100),
        currentPriceCents: Math.round((pos.lastFillPrice ?? 0) * 100),
        marketValueCents,
        weightPercent: totalMarketValueCents > 0 ? (marketValueCents / totalMarketValueCents) * 100 : 0,
        unrealizedPnlCents: marketValueCents - Math.round((pos.totalCostBasis ?? 0) * 100),
      },
      { version, overrides: { pk: `T#${tenantId}`, sk: `PositionSnapshot#${symbol}` } },
    );
  });
};
