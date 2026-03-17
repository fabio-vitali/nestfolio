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
  RECONCILIATION_FAILED: 'RECONCILIATION_FAILED',
  // → Advisory
  PORTFOLIO_DRIFT_DETECTED: 'PORTFOLIO_DRIFT_DETECTED',
} as const;

export type LedgerCrossDomainEventType =
  (typeof LedgerCrossDomainEventTypes)[keyof typeof LedgerCrossDomainEventTypes];
