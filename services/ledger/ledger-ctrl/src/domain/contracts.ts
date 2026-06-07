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
export const BalanceUpdatedSubjectSchema = z.object({
  tenantId: z.string(),
  streamType: z.string().optional(),
  cashBalanceCents: z.number(),
  totalValueCents: z.number().optional(),
  snapshot: LedgerSnapshotSchema,
});
export type BalanceUpdatedSubject = z.infer<typeof BalanceUpdatedSubjectSchema>;

/** PORTFOLIO_UPDATED subject (the PortfolioEvent record). */
export const PortfolioUpdatedSubjectSchema = z.object({
  tenantId: z.string(),
  streamType: z.string().optional(),
  positions: z.record(LedgerPositionSchema),
  positionCount: z.number().optional(),
  totalValueCents: z.number().optional(),
  snapshot: LedgerSnapshotSchema,
});
export type PortfolioUpdatedSubject = z.infer<typeof PortfolioUpdatedSubjectSchema>;

/** LEDGER_ENTRY_RECORDED subject. */
export const LedgerEntrySubjectSchema = z.object({
  tenantId: z.string(),
  streamType: z.string().optional(),
  lastEventSequence: z.number(),
  snapshot: LedgerSnapshotSchema,
});
export type LedgerEntrySubject = z.infer<typeof LedgerEntrySubjectSchema>;
