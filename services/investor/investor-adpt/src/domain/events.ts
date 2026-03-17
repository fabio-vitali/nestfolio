/**
 * Cross-domain event types published by the investor domain.
 * These are the events that other domains may consume.
 */
export const InvestorCrossDomainEventTypes = {
  // → Advisory
  GOAL_UPDATED: 'GOAL_UPDATED',
  RISK_PROFILE_UPDATED: 'RISK_PROFILE_UPDATED',
  OPERATING_MODE_CHANGED: 'OPERATING_MODE_CHANGED',
  MANDATE_GRANTED: 'MANDATE_GRANTED',
  MANDATE_UPDATED: 'MANDATE_UPDATED',
  MANDATE_REVOKED: 'MANDATE_REVOKED',
  // → Execution
  DEPOSIT_INITIATED: 'DEPOSIT_INITIATED',
  WITHDRAWAL_REQUESTED: 'WITHDRAWAL_REQUESTED',
  ACCOUNT_CLOSURE_REQUESTED: 'ACCOUNT_CLOSURE_REQUESTED',
} as const;

export type InvestorCrossDomainEventType =
  (typeof InvestorCrossDomainEventTypes)[keyof typeof InvestorCrossDomainEventTypes];
