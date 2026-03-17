export { ExecutionCrossDomainEventTypes } from './events';
export type { ExecutionCrossDomainEventType } from './events';

// Cross-domain subset types (defined locally to avoid circular deps)
// Source of truth: @nestfolio/broker-adpt/service → events.ts, schemas.ts

export const ExecutionAdptEventTypes = {
  ORDER_ACCEPTED: 'ORDER_ACCEPTED',
  ORDER_PARTIALLY_FILLED: 'ORDER_PARTIALLY_FILLED',
  ORDER_FILLED: 'ORDER_FILLED',
  ORDER_REJECTED: 'ORDER_REJECTED',
  ORDER_CANCELLED: 'ORDER_CANCELLED',
  PORTFOLIO_SNAPSHOT_IMPORTED: 'PORTFOLIO_SNAPSHOT_IMPORTED',
  BROKER_SESSION_ESTABLISHED: 'BROKER_SESSION_ESTABLISHED',
  BROKER_SESSION_LOST: 'BROKER_SESSION_LOST',
  STREAM_CONNECTED: 'STREAM_CONNECTED',
  STREAM_DISCONNECTED: 'STREAM_DISCONNECTED',
  BROKER_AUTHORIZATION_REVOKED: 'BROKER_AUTHORIZATION_REVOKED',
  DEPOSIT_DETECTED: 'DEPOSIT_DETECTED',
  WITHDRAWAL_SUBMITTED: 'WITHDRAWAL_SUBMITTED',
  WITHDRAWAL_COMPLETED: 'WITHDRAWAL_COMPLETED',
  WITHDRAWAL_REJECTED: 'WITHDRAWAL_REJECTED',
} as const;

export type ExecutionAdptEventType =
  (typeof ExecutionAdptEventTypes)[keyof typeof ExecutionAdptEventTypes];

/** Event emitted when an order is fully filled by the broker. */
export interface OrderFilledEvent {
  readonly id: string;
  readonly type: 'ORDER_FILLED';
  readonly timestamp: string;
  readonly subject: {
    readonly orderId: string;
    readonly brokerOrderId: string;
    readonly filledQuantity: number;
    readonly averageFillPrice: number;
    readonly filledAt: string;
  };
  readonly context: {
    readonly tenantId: string;
  };
}

/** Event emitted when a deposit is detected in the broker account. */
export interface DepositDetectedEvent {
  readonly id: string;
  readonly type: 'DEPOSIT_DETECTED';
  readonly timestamp: string;
  readonly subject: {
    readonly depositId: string;
    readonly amountCents: number;
    readonly currency: string;
    readonly detectedAt: string;
  };
  readonly context: {
    readonly tenantId: string;
  };
}
