import { projectVersioned, parseSubject, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';
import { z } from 'zod';
import { LedgerSnapshotSchema } from '@nestfolio/ledger-ctrl/contracts';

const PositionSnapshotSchema = z.object({ snapshot: LedgerSnapshotSchema });

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
  const { snapshot } = parseSubject(uow, PositionSnapshotSchema);

  const version = snapshot.lastEventSequence;

  const entries = Object.entries(snapshot.positions);
  if (entries.length === 0) return [];

  const marketValueCentsOf = (p: { quantity: number; lastFillPrice: number }) =>
    Math.round(p.quantity * p.lastFillPrice * 100);
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
        quantity: pos.quantity,
        avgCostBasisCents: Math.round(pos.averageCostBasis * 100),
        currentPriceCents: Math.round(pos.lastFillPrice * 100),
        marketValueCents,
        weightPercent: totalMarketValueCents > 0 ? (marketValueCents / totalMarketValueCents) * 100 : 0,
        unrealizedPnlCents: marketValueCents - Math.round(pos.totalCostBasis * 100),
      },
      { version, overrides: { pk: `T#${tenantId}`, sk: `PositionSnapshot#${symbol}` } },
    );
  });
};
