/** Events PUBLISHED by decision-workflow-ctrl */
export const DecisionWorkflowEventTypes = {
  // Lifecycle events (CDC from DDB)
  DECISION_PACKET_CREATED: 'DECISION_PACKET_CREATED',
  DECISION_PACKET_ENRICHED: 'DECISION_PACKET_ENRICHED',

  // Agent trigger events (published by Step Functions via EventBridge integration)
  ANALYZE_INVESTOR_PROFILE: 'ANALYZE_INVESTOR_PROFILE',
  ANALYZE_MARKET: 'ANALYZE_MARKET',
  CONSTRUCT_PORTFOLIO: 'CONSTRUCT_PORTFOLIO',
  GENERATE_NARRATIVE: 'GENERATE_NARRATIVE',

  // Post-agent lifecycle
  RECOMMENDATION_PROPOSED: 'RECOMMENDATION_PROPOSED',
  USER_CONFIRMATION_REQUESTED: 'USER_CONFIRMATION_REQUESTED',

  // Feedback loop
  DECISION_FEEDBACK: 'DECISION_FEEDBACK',

  // Error
  DECISION_WORKFLOW_FAILED: 'DECISION_WORKFLOW_FAILED',
} as const;

export type DecisionWorkflowEventType =
  (typeof DecisionWorkflowEventTypes)[keyof typeof DecisionWorkflowEventTypes];

/**
 * Inbound event types consumed by decision-workflow-ctrl (17 total).
 * Grouped by routing action in the event-listener.
 */

/** 9 trigger events → start new Step Functions execution */
export const TRIGGER_EVENT_TYPES = [
  'MANDATE_GRANTED',
  'GOAL_UPDATED',
  'RISK_PROFILE_UPDATED',
  'OPERATING_MODE_CHANGED',
  'PORTFOLIO_DRIFT_DETECTED',
  'ORDER_FILLED',
  'ORDER_REJECTED',
  'ORDER_CANCELLED',
  'DEPOSIT_DETECTED',
] as const;

/** 4 agent completion events → SendTaskSuccess with agent outputs */
export const AGENT_COMPLETION_EVENT_TYPES = [
  'INVESTOR_PROFILE_COMPLETED',
  'MARKET_ANALYSIS_COMPLETED',
  'PORTFOLIO_COMPLETED',
  'NARRATIVE_COMPLETED',
] as const;

/** 2 compliance events → SendTaskSuccess with approved/blocked */
export const COMPLIANCE_EVENT_TYPES = [
  'DECISION_APPROVED',
  'DECISION_BLOCKED',
] as const;

/** 2 user response events → SendTaskSuccess with confirmed/rejected */
export const USER_RESPONSE_EVENT_TYPES = [
  'USER_CONFIRMED',
  'USER_REJECTED',
] as const;

/** All 17 inbound event types for Ingress EventBridge rules */
export const ALL_INBOUND_EVENT_TYPES = [
  ...TRIGGER_EVENT_TYPES,
  ...AGENT_COMPLETION_EVENT_TYPES,
  ...COMPLIANCE_EVENT_TYPES,
  ...USER_RESPONSE_EVENT_TYPES,
] as const;
