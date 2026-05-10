import { eventName } from '@nestfolio/event-types';

/**
 * Cross-domain event types published by the investor domain.
 * These are the events that other domains may consume.
 */
export const InvestorCrossDomainEventTypes = {
  // → Advisory
  GOAL_UPDATED: eventName('GOAL_UPDATED'),
  RISK_PROFILE_UPDATED: eventName('RISK_PROFILE_UPDATED'),
  OPERATING_MODE_CHANGED: eventName('OPERATING_MODE_CHANGED'),
  MANDATE_CREATED: eventName('MANDATE_CREATED'),
  MANDATE_UPDATED: eventName('MANDATE_UPDATED'),
  // → Execution
  DEPOSIT_INITIATED: eventName('DEPOSIT_INITIATED'),
  WITHDRAWAL_REQUESTED: eventName('WITHDRAWAL_REQUESTED'),
  ACCOUNT_CLOSURE_REQUESTED: eventName('ACCOUNT_CLOSURE_REQUESTED'),
  EXECUTION_MODE_CHANGED: eventName('EXECUTION_MODE_CHANGED'),
} as const;

/**
 * Events ingested by the investor domain from external domain buses.
 * The investor adapter deploys EB rules on these foreign buses to pull events into InvestorBus.
 */
export const InvestorIngestEventTypes = {
  // From Advisory
  DECISION_PACKET_CREATED: eventName('DECISION_PACKET_CREATED'),
  USER_CONFIRMATION_REQUESTED: eventName('USER_CONFIRMATION_REQUESTED'),
  EXPLANATION_GENERATED: eventName('EXPLANATION_GENERATED'),
  DECISION_APPROVED: eventName('DECISION_APPROVED'),
  DECISION_BLOCKED: eventName('DECISION_BLOCKED'),
  ESCALATION_TRIGGERED: eventName('ESCALATION_TRIGGERED'),
  INCIDENT_DETECTED: eventName('INCIDENT_DETECTED'),
  INCIDENT_RESOLVED: eventName('INCIDENT_RESOLVED'),
  // From Execution
  ORDER_STAGED: eventName('ORDER_STAGED'),
  ORDER_FILLED: eventName('ORDER_FILLED'),
  ORDER_REJECTED: eventName('ORDER_REJECTED'),
  ORDER_CANCELLED: eventName('ORDER_CANCELLED'),
  DEPOSIT_DETECTED: eventName('DEPOSIT_DETECTED'),
  WITHDRAWAL_COMPLETED: eventName('WITHDRAWAL_COMPLETED'),
  ORDER_ESCALATED: eventName('ORDER_ESCALATED'),
  BROKER_CIRCUIT_OPEN: eventName('BROKER_CIRCUIT_OPEN'),
  BROKER_CIRCUIT_CLOSED: eventName('BROKER_CIRCUIT_CLOSED'),
  BROKER_HEAL_ESCALATED: eventName('BROKER_HEAL_ESCALATED'),
  TRANSFER_FAILED: eventName('TRANSFER_FAILED'),
  // From Ledger
  BALANCE_UPDATED: eventName('BALANCE_UPDATED'),
  LEDGER_ENTRY_RECORDED: eventName('LEDGER_ENTRY_RECORDED'),
  LEDGER_PROCESSING_FAILED: eventName('LEDGER_PROCESSING_FAILED'),
  PORTFOLIO_DRIFT_DETECTED: eventName('PORTFOLIO_DRIFT_DETECTED'),
  PORTFOLIO_UPDATED: eventName('PORTFOLIO_UPDATED'),
  RECONCILIATION_COMPLETED: eventName('RECONCILIATION_COMPLETED'),
} as const;
