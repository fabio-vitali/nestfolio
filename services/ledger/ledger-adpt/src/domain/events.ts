/**
 * Cross-domain event types published by the ledger domain.
 * These are the events that other domains may consume.
 */
export const LedgerCrossDomainEventTypes = {
  // → Investor
  BALANCE_UPDATED: 'BALANCE_UPDATED',
  PORTFOLIO_UPDATED: 'PORTFOLIO_UPDATED',
  LEDGER_ENTRY_RECORDED: 'LEDGER_ENTRY_RECORDED',
  LEDGER_PROCESSING_FAILED: 'LEDGER_PROCESSING_FAILED',
  RECONCILIATION_COMPLETED: 'RECONCILIATION_COMPLETED',
  // → Advisory
  PORTFOLIO_DRIFT_DETECTED: 'PORTFOLIO_DRIFT_DETECTED',
} as const;

/**
 * Events ingested by the ledger domain from external domain buses.
 * The ledger adapter deploys EB rules on these foreign buses to pull events into LedgerBus.
 */
export const LedgerIngestEventTypes = {
  // From Execution
  ORDER_FILLED: 'ORDER_FILLED',
  ORDER_PARTIALLY_FILLED: 'ORDER_PARTIALLY_FILLED',
  ORDER_REJECTED: 'ORDER_REJECTED',
  ORDER_CANCELLED: 'ORDER_CANCELLED',
  DEPOSIT_DETECTED: 'DEPOSIT_DETECTED',
  WITHDRAWAL_COMPLETED: 'WITHDRAWAL_COMPLETED',
  CORPORATE_ACTION_APPLIED: 'CORPORATE_ACTION_APPLIED',
  PORTFOLIO_SNAPSHOT_IMPORTED: 'PORTFOLIO_SNAPSHOT_IMPORTED',
  ALPACA_ACCOUNT_SNAPSHOT: 'ALPACA_ACCOUNT_SNAPSHOT',
} as const;
