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
  BROKER_CIRCUIT_CLOSED: eventName('BROKER_CIRCUIT_CLOSED'),
  BROKER_HEAL_ESCALATED: eventName('BROKER_HEAL_ESCALATED'),
  // → Investor + Ledger + Advisory
  ORDER_FILLED: eventName('ORDER_FILLED'),
  ORDER_PARTIALLY_FILLED: eventName('ORDER_PARTIALLY_FILLED'),
  // → Investor + Advisory (not Ledger)
  DEPOSIT_DETECTED: eventName('DEPOSIT_DETECTED'),
  // → Investor + Ledger
  DEPOSIT_SETTLED: eventName('DEPOSIT_SETTLED'),
  WITHDRAWAL_SETTLED: eventName('WITHDRAWAL_SETTLED'),
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
  USER_CONFIRMED: eventName('USER_CONFIRMED'),
  // From Investor
  DEPOSIT_INITIATED: eventName('DEPOSIT_INITIATED'),
  WITHDRAWAL_INITIATED: eventName('WITHDRAWAL_INITIATED'),
  ACCOUNT_CLOSURE_REQUESTED: eventName('ACCOUNT_CLOSURE_REQUESTED'),
  EXECUTION_MODE_CHANGED: eventName('EXECUTION_MODE_CHANGED'),
} as const;
