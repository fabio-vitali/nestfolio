import { eventName } from '@nestfolio/event-types';

/** Events PUBLISHED by investor-profile-ctrl */
export const InvestorProfileEventTypes = {
  GOAL_INTERPRETATION_PRODUCED: eventName('GOAL_INTERPRETATION_PRODUCED'),
  RISK_EVALUATION_PRODUCED: eventName('RISK_EVALUATION_PRODUCED'),
  INVESTOR_PROFILE_AGENT_INVOCATION_TRACED: eventName('INVESTOR_PROFILE_AGENT_INVOCATION_TRACED'),
  INVESTOR_PROFILE_SNAPSHOT_CREATED: eventName('INVESTOR_PROFILE_SNAPSHOT_CREATED'),
  INVESTOR_PROFILE_SNAPSHOT_UPDATED: eventName('INVESTOR_PROFILE_SNAPSHOT_UPDATED'),
} as const;

/** Inbound event types consumed by investor-profile-ctrl */
export const HANDLED_EVENT_TYPES = [
  'INVESTOR_PROFILE_UPDATED',
  'MANDATE_ISSUED',
] as const;

/** KB ingestion event types — routed to kb-ingestion-handler */
export const KB_INGESTION_EVENT_TYPES = new Set([
  eventName('DECISION_BLOCKED'),
  eventName('DECISION_APPROVED'),
]);
