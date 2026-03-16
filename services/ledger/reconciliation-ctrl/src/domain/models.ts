/** Reconciliation status. */
export type ReconciliationStatus =
  | 'REQUIRED'
  | 'STARTED'
  | 'COMPLETED'
  | 'FAILED';

/** Result of a portfolio reconciliation. */
export interface Reconciliation {
  readonly reconciliationId: string;
  readonly tenantId: string;
  readonly portfolioId: string;
  readonly status: ReconciliationStatus;
  readonly discrepancies: ReadonlyArray<{
    readonly symbol: string;
    readonly expectedQuantity: number;
    readonly actualQuantity: number;
    readonly delta: number;
  }>;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly failedAt: string | null;
  readonly failureReason: string | null;
}
