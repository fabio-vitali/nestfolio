import { projectVersioned, parseSubject, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';
import { LedgerSnapshotSchema } from '@nestfolio/ledger-adpt/domain';
import { z } from 'zod';

// Of the three event types the event-listener routes here, only these two carry a
// ledger snapshot. RECONCILIATION_COMPLETED carries a ReconciliationResult (no
// `snapshot`) and is a deliberate no-op — NOT a contract violation, so it must not
// reach `parseSubject` (which would throw it to the DLQ).
const SNAPSHOT_EVENT_TYPES = new Set(['BALANCE_UPDATED', 'PORTFOLIO_UPDATED']);

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
  if (!SNAPSHOT_EVENT_TYPES.has(event.type)) return undefined; // e.g. RECONCILIATION_COMPLETED is a no-op here
  const { snapshot } = parseSubject(uow, z.object({ snapshot: LedgerSnapshotSchema }));
  const version = snapshot.lastEventSequence;

  const positions = snapshot.positions;
  // Holdings are quantity > 0; fully-exited symbols persist in the snapshot at
  // quantity 0 (the reducer keeps them) and must not inflate the count.
  const held = Object.values(positions).filter((p) => (p.quantity ?? 0) > 0);
  const positionMarketValueCents = held.reduce(
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
      positionCount: held.length,
      totalValueCents: snapshot.cashBalanceCents + positionMarketValueCents,
    },
    {
      version,
      overrides: { pk: `T#${tenantId}`, sk: 'PortfolioSummary' },
    },
  );
};
