import { eventName } from '@nestfolio/event-types';
import { InvestorBffEventTypes } from '@nestfolio/investor-bff/events';

export const DecisionWorkflowEventTypes = {
  DECISION_PACKET_CREATED: eventName('DECISION_PACKET_CREATED'),
  DECISION_PACKET_UPDATED: eventName('DECISION_PACKET_UPDATED'),
  CONSTRUCT_PORTFOLIO: eventName('CONSTRUCT_PORTFOLIO'),
  GENERATE_NARRATIVE: eventName('GENERATE_NARRATIVE'),
  RECOMMENDATION_PROPOSED: eventName('RECOMMENDATION_PROPOSED'),
  USER_CONFIRMATION_REQUESTED: eventName('USER_CONFIRMATION_REQUESTED'),
  DECISION_FEEDBACK: eventName('DECISION_FEEDBACK'),
  DECISION_WORKFLOW_FAILED: eventName('DECISION_WORKFLOW_FAILED'),
  AGENT_OUTPUT_CREATED: eventName('AGENT_OUTPUT_CREATED'),
  AGENT_OUTPUT_UPDATED: eventName('AGENT_OUTPUT_UPDATED'),
  MANDATE_SNAPSHOT_CREATED: eventName('MANDATE_SNAPSHOT_CREATED'),
} as const;

// SF triggers. INVESTOR_PROFILE_CREATED removed: replaced by MANDATE_SNAPSHOT_CREATED
// (CDC of decision-workflow-ctrl-owned MandateSnapshot:INSERT — guarantees the
// projection is committed before the SF starts → SF unconditionally LookupMandateSnapshot).
export const TRIGGER_EVENT_TYPES = [
  eventName('MANDATE_SNAPSHOT_CREATED'),
  eventName('INVESTOR_PROFILE_UPDATED'),
  eventName('PORTFOLIO_DRIFT_DETECTED'),
  eventName('ORDER_FILLED'),
  eventName('ORDER_REJECTED'),
  eventName('ORDER_CANCELLED'),
  eventName('DEPOSIT_DETECTED'),
] as const;

export const MANDATE_LIFECYCLE_EVENT_TYPES = [
  InvestorBffEventTypes.MANDATE_ISSUED,
  InvestorBffEventTypes.OPERATING_MODE_CHANGED,
] as const;

// Post-precomputation rewire: IP + MI are now precomputed projections (no per-cycle
// agent invocation, no SF waitForTaskToken). Only PE + AN still emit completions
// that resume the SF via SendTaskSuccess; failures resume via SendTaskFailure.
export const AGENT_COMPLETION_EVENT_TYPES = [
  eventName('PORTFOLIO_COMPLETED'),
  eventName('NARRATIVE_COMPLETED'),
] as const;

export const AGENT_FAILURE_EVENT_TYPES = [
  eventName('PORTFOLIO_FAILED'),
  eventName('NARRATIVE_FAILED'),
] as const;

export const COMPLIANCE_EVENT_TYPES = [
  eventName('DECISION_APPROVED'),
  eventName('DECISION_BLOCKED'),
] as const;

export const USER_RESPONSE_EVENT_TYPES = [
  eventName('USER_CONFIRMED'),
  eventName('USER_REJECTED'),
] as const;

export const ALL_INBOUND_EVENT_TYPES = [
  ...AGENT_COMPLETION_EVENT_TYPES,
  ...AGENT_FAILURE_EVENT_TYPES,
  ...COMPLIANCE_EVENT_TYPES,
  ...USER_RESPONSE_EVENT_TYPES,
] as const;
