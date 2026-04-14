import { eventName } from '@nestfolio/event-types';

/**
 * Cross-domain event types published by the ledger domain.
 * These are the events that other domains may consume.
 */
export const LedgerCrossDomainEventTypes = {
  // → Investor
  BALANCE_UPDATED: eventName('BALANCE_UPDATED'),
  PORTFOLIO_UPDATED: eventName('PORTFOLIO_UPDATED'),
  LEDGER_ENTRY_RECORDED: eventName('LEDGER_ENTRY_RECORDED'),
  LEDGER_PROCESSING_FAILED: eventName('LEDGER_PROCESSING_FAILED'),
  RECONCILIATION_COMPLETED: eventName('RECONCILIATION_COMPLETED'),
  // → Advisory
  PORTFOLIO_DRIFT_DETECTED: eventName('PORTFOLIO_DRIFT_DETECTED'),
} as const;

/**
 * Events ingested by the ledger domain from external domain buses.
 * The ledger adapter deploys EB rules on these foreign buses to pull events into LedgerBus.
 */
export const LedgerIngestEventTypes = {
  // From Execution
  ORDER_FILLED: eventName('ORDER_FILLED'),
  ORDER_PARTIALLY_FILLED: eventName('ORDER_PARTIALLY_FILLED'),
  ORDER_REJECTED: eventName('ORDER_REJECTED'),
  ORDER_CANCELLED: eventName('ORDER_CANCELLED'),
  DEPOSIT_DETECTED: eventName('DEPOSIT_DETECTED'),
  WITHDRAWAL_COMPLETED: eventName('WITHDRAWAL_COMPLETED'),
  TRANSFER_FAILED: eventName('TRANSFER_FAILED'),
  CORPORATE_ACTION_APPLIED: eventName('CORPORATE_ACTION_APPLIED'),
  PORTFOLIO_SNAPSHOT_IMPORTED: eventName('PORTFOLIO_SNAPSHOT_IMPORTED'),
  ALPACA_ACCOUNT_SNAPSHOT: eventName('ALPACA_ACCOUNT_SNAPSHOT'),
  // From Advisory (direct)
  DECISION_PACKET_CREATED: eventName('DECISION_PACKET_CREATED'),
} as const;
