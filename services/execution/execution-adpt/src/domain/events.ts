import { eventName } from '@nestfolio/event-types';

/**
 * Cross-domain event types published by the execution domain.
 * These are the events that other domains may consume.
 */
export const ExecutionCrossDomainEventTypes = {
  // → Investor
  ORDER_STAGED: eventName('ORDER_STAGED'),
  ORDER_REJECTED: eventName('ORDER_REJECTED'),
  ORDER_CANCELLED: eventName('ORDER_CANCELLED'),
  ORDER_ESCALATED: eventName('ORDER_ESCALATED'),
  BROKER_CIRCUIT_OPEN: eventName('BROKER_CIRCUIT_OPEN'),
  // → Investor + Ledger + Advisory
  ORDER_FILLED: eventName('ORDER_FILLED'),
  ORDER_PARTIALLY_FILLED: eventName('ORDER_PARTIALLY_FILLED'),
  DEPOSIT_DETECTED: eventName('DEPOSIT_DETECTED'),
  WITHDRAWAL_COMPLETED: eventName('WITHDRAWAL_COMPLETED'),
  TRANSFER_FAILED: eventName('TRANSFER_FAILED'),
  // → Ledger (planned — no producer yet)
  CORPORATE_ACTION_APPLIED: eventName('CORPORATE_ACTION_APPLIED'),
  PORTFOLIO_SNAPSHOT_IMPORTED: eventName('PORTFOLIO_SNAPSHOT_IMPORTED'),
  ALPACA_ACCOUNT_SNAPSHOT: eventName('ALPACA_ACCOUNT_SNAPSHOT'),
} as const;

/**
 * Events ingested by the execution domain from external domain buses.
 * The execution adapter deploys EB rules on these foreign buses to pull events into ExecutionBus.
 */
export const ExecutionIngestEventTypes = {
  // From Advisory
  DECISION_APPROVED: eventName('DECISION_APPROVED'),
  DECISION_PACKET_CREATED: eventName('DECISION_PACKET_CREATED'),
  USER_CONFIRMED: eventName('USER_CONFIRMED'),
  CIRCUIT_BREAKER_TRIGGERED: eventName('CIRCUIT_BREAKER_TRIGGERED'),
  CIRCUIT_BREAKER_RESET: eventName('CIRCUIT_BREAKER_RESET'),
  // From Investor
  DEPOSIT_INITIATED: eventName('DEPOSIT_INITIATED'),
  WITHDRAWAL_REQUESTED: eventName('WITHDRAWAL_REQUESTED'),
  ACCOUNT_CLOSURE_REQUESTED: eventName('ACCOUNT_CLOSURE_REQUESTED'),
  EXECUTION_MODE_CHANGED: eventName('EXECUTION_MODE_CHANGED'),
} as const;
