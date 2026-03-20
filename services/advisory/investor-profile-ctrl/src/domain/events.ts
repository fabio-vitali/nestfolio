/** Events PUBLISHED by investor-profile-ctrl */
export const InvestorProfileEventTypes = {
  INVESTOR_PROFILE_COMPLETED: 'INVESTOR_PROFILE_COMPLETED',
  GOAL_INTERPRETATION_PRODUCED: 'GOAL_INTERPRETATION_PRODUCED',
  RISK_EVALUATION_PRODUCED: 'RISK_EVALUATION_PRODUCED',
} as const;

export type InvestorProfileEventType =
  (typeof InvestorProfileEventTypes)[keyof typeof InvestorProfileEventTypes];

/** Inbound event types consumed by investor-profile-ctrl */
export const HANDLED_EVENT_TYPES = new Set([
  'ANALYZE_INVESTOR_PROFILE',
]);

/** KB ingestion event types — routed to kb-ingestion-handler */
export const KB_INGESTION_EVENT_TYPES = new Set([
  'DECISION_BLOCKED',
  'DECISION_APPROVED',
]);
