/** Order status lifecycle. */
export type OrderStatus =
  | 'SUBMITTED'
  | 'STAGED'
  | 'ACCEPTED'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'FAILED';

/** Order side. */
export type OrderSide = 'BUY' | 'SELL';

/** Order type. */
export type OrderType = 'MARKET' | 'LIMIT';

/** Reconciliation status. */
export type ReconciliationStatus =
  | 'REQUIRED'
  | 'STARTED'
  | 'COMPLETED'
  | 'FAILED';

/** An order submitted to the broker. */
export interface Order {
  readonly orderId: string;
  readonly tenantId: string;
  readonly decisionId: string;
  readonly symbol: string;
  readonly side: OrderSide;
  readonly type: OrderType;
  readonly quantity: number;
  readonly limitPrice: number | null;
  readonly currency: string;
  readonly status: OrderStatus;
  readonly filledQuantity: number;
  readonly averageFillPrice: number | null;
  readonly brokerOrderId: string | null;
  readonly submittedAt: string;
  readonly filledAt: string | null;
  readonly rejectedAt: string | null;
  readonly rejectionReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A single position within a portfolio. */
export interface Position {
  readonly symbol: string;
  readonly assetClass: string;
  readonly quantity: number;
  readonly averageCostBasisCents: number;
  readonly currentPriceCents: number;
  readonly marketValueCents: number;
  readonly weightPercent: number;
  readonly targetWeightPercent: number;
  readonly unrealizedPnlCents: number;
  readonly lastUpdatedAt: string;
}

/** Portfolio aggregate for a tenant. */
export interface Portfolio {
  readonly portfolioId: string;
  readonly tenantId: string;
  readonly positions: ReadonlyArray<Position>;
  readonly cashBalanceCents: number;
  readonly totalValueCents: number;
  readonly currency: string;
  readonly driftPercent: number;
  readonly lastSnapshotAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

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
