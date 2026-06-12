import { eventName } from '@nestfolio/event-types';

/**
 * Cross-domain event names that downstream domains import from investor-adpt.
 * Most outbound investor events are owned by other maps (InvestorBffEventTypes,
 * BrokerCtrlInboundEventTypes, ExecutionIngestEventTypes); this map exists only
 * for the names imported by name from `@nestfolio/investor-adpt/domain`.
 */
export const InvestorCrossDomainEventTypes = {
  // → Execution (consumed by execution-ctrl/handlers/event-listener.ts)
  ACCOUNT_CLOSURE_REQUESTED: eventName('ACCOUNT_CLOSURE_REQUESTED'),
  // → Advisory
  INVESTOR_PROFILE_UPDATED: eventName('INVESTOR_PROFILE_UPDATED'),
  MANDATE_ISSUED: eventName('MANDATE_ISSUED'),
  MANDATE_REVOKED: eventName('MANDATE_REVOKED'),
  OPERATING_MODE_CHANGED: eventName('OPERATING_MODE_CHANGED'),
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
  ADVISORY_STATUS_UPDATED: eventName('ADVISORY_STATUS_UPDATED'),
  // From Execution
  ORDER_STAGED: eventName('ORDER_STAGED'),
  ORDER_FILLED: eventName('ORDER_FILLED'),
  ORDER_REJECTED: eventName('ORDER_REJECTED'),
  ORDER_CANCELLED: eventName('ORDER_CANCELLED'),
  DEPOSIT_REQUESTED: eventName('DEPOSIT_REQUESTED'),
  DEPOSIT_DETECTED: eventName('DEPOSIT_DETECTED'),
  DEPOSIT_SETTLED: eventName('DEPOSIT_SETTLED'),
  DEPOSIT_FAILED: eventName('DEPOSIT_FAILED'),
  WITHDRAWAL_REQUESTED: eventName('WITHDRAWAL_REQUESTED'),
  WITHDRAWAL_SETTLED: eventName('WITHDRAWAL_SETTLED'),
  WITHDRAWAL_FAILED: eventName('WITHDRAWAL_FAILED'),
  ORDER_ESCALATED: eventName('ORDER_ESCALATED'),
  BROKER_CIRCUIT_OPEN: eventName('BROKER_CIRCUIT_OPEN'),
  BROKER_CIRCUIT_CLOSED: eventName('BROKER_CIRCUIT_CLOSED'),
  BROKER_HEAL_ESCALATED: eventName('BROKER_HEAL_ESCALATED'),
  // From Ledger
  BALANCE_UPDATED: eventName('BALANCE_UPDATED'),
  LEDGER_ENTRY_RECORDED: eventName('LEDGER_ENTRY_RECORDED'),
  LEDGER_PROCESSING_FAILED: eventName('LEDGER_PROCESSING_FAILED'),
  PORTFOLIO_DRIFT_DETECTED: eventName('PORTFOLIO_DRIFT_DETECTED'),
  PORTFOLIO_UPDATED: eventName('PORTFOLIO_UPDATED'),
  RECONCILIATION_COMPLETED: eventName('RECONCILIATION_COMPLETED'),
} as const;
