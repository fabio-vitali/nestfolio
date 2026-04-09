import { eventName } from '@nestfolio/event-types';

/** Events PUBLISHED by investor-profile-ctrl */
export const InvestorProfileEventTypes = {
  INVESTOR_PROFILE_COMPLETED: eventName('INVESTOR_PROFILE_COMPLETED'),
  GOAL_INTERPRETATION_PRODUCED: eventName('GOAL_INTERPRETATION_PRODUCED'),
  RISK_EVALUATION_PRODUCED: eventName('RISK_EVALUATION_PRODUCED'),
} as const;

/** Inbound event types consumed by investor-profile-ctrl */
export const HANDLED_EVENT_TYPES = new Set([
  eventName('ANALYZE_INVESTOR_PROFILE'),
]);

/** KB ingestion event types — routed to kb-ingestion-handler */
export const KB_INGESTION_EVENT_TYPES = new Set([
  eventName('DECISION_BLOCKED'),
  eventName('DECISION_APPROVED'),
]);
