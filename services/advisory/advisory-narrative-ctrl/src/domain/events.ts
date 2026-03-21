/** Events PUBLISHED by advisory-narrative-ctrl */
export const NarrativeEventTypes = {
  NARRATIVE_COMPLETED: 'NARRATIVE_COMPLETED',
  EXPLANATION_GENERATED: 'EXPLANATION_GENERATED',
} as const;

/** Inbound event types consumed by advisory-narrative-ctrl */
export const HANDLED_EVENT_TYPES = new Set([
  'GENERATE_NARRATIVE',
  'DECISION_FEEDBACK',
]);

/** Feedback event type — routed to feedback-correlator */
export const FEEDBACK_EVENT_TYPES = new Set([
  'DECISION_FEEDBACK',
]);
