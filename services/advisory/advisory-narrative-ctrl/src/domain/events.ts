import { eventName } from '@nestfolio/event-types';

/** Events PUBLISHED by advisory-narrative-ctrl */
export const NarrativeEventTypes = {
  NARRATIVE_COMPLETED: eventName('NARRATIVE_COMPLETED'),
  NARRATIVE_FAILED: eventName('NARRATIVE_FAILED'),
  EXPLANATION_GENERATED: eventName('EXPLANATION_GENERATED'),
  ADVISORY_NARRATIVE_AGENT_INVOCATION_TRACED: eventName('ADVISORY_NARRATIVE_AGENT_INVOCATION_TRACED'),
} as const;

/** Inbound event types consumed by advisory-narrative-ctrl */
export const HANDLED_EVENT_TYPES = new Set([
  eventName('GENERATE_NARRATIVE'),
  eventName('DECISION_FEEDBACK'),
]);

/** Feedback event type — routed to feedback-correlator */
export const FEEDBACK_EVENT_TYPES = new Set([
  eventName('DECISION_FEEDBACK'),
]);
