import { eventName } from '@nestfolio/event-types';

/**
 * Cross-domain event types published by the advisory domain.
 * These are the events that other domains may consume.
 */
export const AdvisoryCrossDomainEventTypes = {
  // → Investor + Execution
  DECISION_PACKET_CREATED: eventName('DECISION_PACKET_CREATED'),
  DECISION_APPROVED: eventName('DECISION_APPROVED'),
  // → Investor only
  USER_CONFIRMATION_REQUESTED: eventName('USER_CONFIRMATION_REQUESTED'),
  EXPLANATION_GENERATED: eventName('EXPLANATION_GENERATED'),
  DECISION_BLOCKED: eventName('DECISION_BLOCKED'),
  ESCALATION_TRIGGERED: eventName('ESCALATION_TRIGGERED'),
  INCIDENT_DETECTED: eventName('INCIDENT_DETECTED'),
  INCIDENT_RESOLVED: eventName('INCIDENT_RESOLVED'),
  ADVISORY_STATUS_UPDATED: eventName('ADVISORY_STATUS_UPDATED'),
  // → Execution only
  USER_CONFIRMED: eventName('USER_CONFIRMED'),
} as const;

/**
 * Events ingested by the advisory domain from external domain buses.
 * The advisory adapter deploys EB rules on these foreign buses to pull events into AdvisoryBus.
 */
export const AdvisoryIngestEventTypes = {
  // From Investor
  INVESTOR_PROFILE_CREATED: eventName('INVESTOR_PROFILE_CREATED'),
  INVESTOR_PROFILE_UPDATED: eventName('INVESTOR_PROFILE_UPDATED'),
  MANDATE_ISSUED: eventName('MANDATE_ISSUED'),
  MANDATE_REVOKED: eventName('MANDATE_REVOKED'),
  OPERATING_MODE_CHANGED: eventName('OPERATING_MODE_CHANGED'),
  // From Execution
  ORDER_FILLED: eventName('ORDER_FILLED'),
  ORDER_REJECTED: eventName('ORDER_REJECTED'),
  ORDER_CANCELLED: eventName('ORDER_CANCELLED'),
  DEPOSIT_DETECTED: eventName('DEPOSIT_DETECTED'),
  // From Ledger
  PORTFOLIO_UPDATED: eventName('PORTFOLIO_UPDATED'),
  PORTFOLIO_DRIFT_DETECTED: eventName('PORTFOLIO_DRIFT_DETECTED'),
} as const;
