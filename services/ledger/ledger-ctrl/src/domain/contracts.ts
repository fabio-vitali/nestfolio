// Producer-owned event payload contracts for ledger-ctrl. Imports ONLY zod.
import { z, type ZodTypeAny } from 'zod';

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

/** BALANCE_UPDATED subject (the BalanceEvent record). Dry domain subject —
 * tenantId/userId/region travel in the event context (RequestContext), not here. */
export const BalanceUpdatedSchema = z.object({
  streamType: z.string().optional(),
  cashBalanceCents: z.number(),
  totalValueCents: z.number().optional(),
  snapshot: LedgerSnapshotSchema,
});
export type BalanceUpdated = z.infer<typeof BalanceUpdatedSchema>;

/** PORTFOLIO_UPDATED subject (the PortfolioEvent record). Dry domain subject —
 * identity travels in the event context (RequestContext), not here. */
export const PortfolioUpdatedSchema = z.object({
  streamType: z.string().optional(),
  positions: z.record(LedgerPositionSchema),
  positionCount: z.number().optional(),
  totalValueCents: z.number().optional(),
  snapshot: LedgerSnapshotSchema,
});
export type PortfolioUpdated = z.infer<typeof PortfolioUpdatedSchema>;

/** LEDGER_ENTRY_RECORDED subject. Dry domain subject — identity travels in the event context. */
export const LedgerEntryRecordedSchema = z.object({
  streamType: z.string().optional(),
  lastEventSequence: z.number(),
  // snapshotAt is the AccountSnapshot row's ISO timestamp (ledger.repository
  // sets it unconditionally on every snapshot write), emitted by snapshotToEvents.
  snapshotAt: z.string(),
  snapshot: LedgerSnapshotSchema,
});
export type LedgerEntryRecorded = z.infer<typeof LedgerEntryRecordedSchema>;

/** The persisted AccountSnapshot row aggregate (the `Snapshot#latest` item the
 * reducer materializes; the source SnapshotRecord the CDC transform reads). Dry
 * subject — identity (tenant/user/region) travels in the RequestContext. */
export const AccountSnapshotSchema = z.object({
  streamType: z.string(),
  positions: z.record(LedgerPositionSchema),
  cashBalanceCents: z.number(),
  totalValueCents: z.number(),
  positionCount: z.number().optional(),
  lastEventSequence: z.number(),
  version: z.number(),
  snapshotAt: z.string(),
  timestamp: z.string(),
});
export type AccountSnapshot = z.infer<typeof AccountSnapshotSchema>;

/** A single tax lot (FIFO cost-basis tracking). Dry subject — pk/sk/__typename/tenantId
 * are key/envelope fields (TableEntry), not payload; tenant identity travels in the context. */
export const TaxLotSchema = z.object({
  lotId: z.string(),
  symbol: z.string(),
  quantity: z.number(),
  costBasisPerShare: z.number(),
  acquiredAt: z.string(),
  status: z.enum(['open', 'closed']),
});
export type TaxLot = z.infer<typeof TaxLotSchema>;

/** Append-only snapshot-history aggregate (TTL'd). Internal — not CDC-emitted. */
export const SnapshotHistorySchema = z.object({
  streamType: z.string(),
  positions: z.record(LedgerPositionSchema),
  cashBalanceCents: z.number(),
  lastEventSequence: z.number(),
});
export type SnapshotHistory = z.infer<typeof SnapshotHistorySchema>;

/** Failure events (LEDGER_PROCESSING_FAILED, LEDGER_SNAPSHOT_PUBLISHER_FAILED) use
 * the SHARED platform contract — import { ErrorEventSubjectSchema } from
 * '@nestfolio/event-processor'. They are not producer aggregates. */

/**
 * Test-fixture event→subject map for ledger-ctrl's CDC emissions. Co-located with the
 * producer-owned schemas (single source of truth); consumed only by `@nestfolio/test-contracts`.
 * Grows across Tasks 1–3 (BALANCE_UPDATED, then PORTFOLIO_UPDATED, then LEDGER_ENTRY_RECORDED).
 * Only the primary insert detailTypes are registered (the `*_EVENT_UPDATED` modify variants and the
 * `*_FAILED` error events are not injected by any fixture and use the shared platform error contract).
 */
export const ledgerCtrlEventSubjects = {
  BALANCE_UPDATED: BalanceUpdatedSchema,
  PORTFOLIO_UPDATED: PortfolioUpdatedSchema,
} as const satisfies Record<string, ZodTypeAny>;
