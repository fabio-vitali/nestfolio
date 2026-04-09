import { eventName } from '@nestfolio/event-types';

/** Events PUBLISHED by decision-workflow-ctrl */
export const DecisionWorkflowEventTypes = {
  // Lifecycle events (CDC from DDB)
  DECISION_PACKET_CREATED: eventName('DECISION_PACKET_CREATED'),
  DECISION_PACKET_UPDATED: eventName('DECISION_PACKET_UPDATED'),

  // Agent trigger events (published by Step Functions via EventBridge integration)
  ANALYZE_INVESTOR_PROFILE: eventName('ANALYZE_INVESTOR_PROFILE'),
  ANALYZE_MARKET: eventName('ANALYZE_MARKET'),
  CONSTRUCT_PORTFOLIO: eventName('CONSTRUCT_PORTFOLIO'),
  GENERATE_NARRATIVE: eventName('GENERATE_NARRATIVE'),

  // Post-agent lifecycle
  RECOMMENDATION_PROPOSED: eventName('RECOMMENDATION_PROPOSED'),
  USER_CONFIRMATION_REQUESTED: eventName('USER_CONFIRMATION_REQUESTED'),

  // Feedback loop
  DECISION_FEEDBACK: eventName('DECISION_FEEDBACK'),

  // Error
  DECISION_WORKFLOW_FAILED: eventName('DECISION_WORKFLOW_FAILED'),

  WORKFLOW_TRIGGER_CREATED: eventName('WORKFLOW_TRIGGER_CREATED'),
  WORKFLOW_TRIGGER_UPDATED: eventName('WORKFLOW_TRIGGER_UPDATED'),
  AGENT_OUTPUT_CREATED: eventName('AGENT_OUTPUT_CREATED'),
  AGENT_OUTPUT_UPDATED: eventName('AGENT_OUTPUT_UPDATED'),
} as const;

/**
 * Inbound event types consumed by decision-workflow-ctrl (19 total).
 * Grouped by routing action in the event-listener.
 */

/** 11 trigger events → start new Step Functions execution */
export const TRIGGER_EVENT_TYPES = [
  eventName('MANDATE_CREATED'),
  eventName('GOAL_CREATED'),
  eventName('GOAL_UPDATED'),
  eventName('RISK_PROFILE_CREATED'),
  eventName('RISK_PROFILE_UPDATED'),
  eventName('OPERATING_MODE_CHANGED'),
  eventName('PORTFOLIO_DRIFT_DETECTED'),
  eventName('ORDER_FILLED'),
  eventName('ORDER_REJECTED'),
  eventName('ORDER_CANCELLED'),
  eventName('DEPOSIT_DETECTED'),
] as const;

/** 4 agent completion events → SendTaskSuccess with agent outputs */
export const AGENT_COMPLETION_EVENT_TYPES = [
  eventName('INVESTOR_PROFILE_COMPLETED'),
  eventName('MARKET_ANALYSIS_COMPLETED'),
  eventName('PORTFOLIO_COMPLETED'),
  eventName('NARRATIVE_COMPLETED'),
] as const;

/** 2 compliance events → SendTaskSuccess with approved/blocked */
export const COMPLIANCE_EVENT_TYPES = [
  eventName('DECISION_APPROVED'),
  eventName('DECISION_BLOCKED'),
] as const;

/** 2 user response events → SendTaskSuccess with confirmed/rejected */
export const USER_RESPONSE_EVENT_TYPES = [
  eventName('USER_CONFIRMED'),
  eventName('USER_REJECTED'),
] as const;

/** All 17 inbound event types for Ingress EventBridge rules */
export const ALL_INBOUND_EVENT_TYPES = [
  ...TRIGGER_EVENT_TYPES,
  ...AGENT_COMPLETION_EVENT_TYPES,
  ...COMPLIANCE_EVENT_TYPES,
  ...USER_RESPONSE_EVENT_TYPES,
] as const;
