// Producer-owned event payload contracts for ledger-ctrl. Imports ONLY zod.
import { z } from 'zod';

export const LedgerPositionSchema = z.object({
  symbol: z.string(),
  quantity: z.number(),
  averageCostBasis: z.number(),
  totalCostBasis: z.number(),
  lastFillPrice: z.number(),
});
export type LedgerPosition = z.infer<typeof LedgerPositionSchema>;

/** The canonical account snapshot wrapped on every ledger event. */
export const LedgerSnapshotSchema = z.object({
  positions: z.record(LedgerPositionSchema),
  cashBalanceCents: z.number(),
  lastEventSequence: z.number(),
});
export type LedgerSnapshot = z.infer<typeof LedgerSnapshotSchema>;

/** BALANCE_UPDATED subject (the BalanceEvent record). */
export const BalanceUpdatedSchema = z.object({
  tenantId: z.string(),
  // userId is always stamped on the published subject by pickRequestContext in the
  // intent executor (changeDataCapture publishes the full DDB record as the subject),
  // so it is required — consumers use it directly in pk templates.
  userId: z.string(),
  streamType: z.string().optional(),
  cashBalanceCents: z.number(),
  totalValueCents: z.number().optional(),
  snapshot: LedgerSnapshotSchema,
});
export type BalanceUpdated = z.infer<typeof BalanceUpdatedSchema>;

/** PORTFOLIO_UPDATED subject (the PortfolioEvent record). */
export const PortfolioUpdatedSchema = z.object({
  // tenantId is stamped by snapshotToEvents (snapshot-to-events.ts line ~52) and
  // published as part of the CDC subject — required here so consumers can key the
  // projected row without falling back to ctx.tenantId.
  tenantId: z.string(),
  streamType: z.string().optional(),
  positions: z.record(LedgerPositionSchema),
  positionCount: z.number().optional(),
  totalValueCents: z.number().optional(),
  snapshot: LedgerSnapshotSchema,
});
export type PortfolioUpdated = z.infer<typeof PortfolioUpdatedSchema>;

/** LEDGER_ENTRY_RECORDED subject. */
export const LedgerEntryRecordedSchema = z.object({
  tenantId: z.string(),
  streamType: z.string().optional(),
  lastEventSequence: z.number(),
  // snapshotAt is the AccountSnapshot row's ISO timestamp (ledger.repository
  // sets it unconditionally on every snapshot write), emitted by snapshotToEvents.
  snapshotAt: z.string(),
  snapshot: LedgerSnapshotSchema,
});
export type LedgerEntryRecorded = z.infer<typeof LedgerEntryRecordedSchema>;
