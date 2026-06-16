import type { z, ZodTypeAny } from 'zod';
import { mandateEventSubjects } from '@nestfolio/investor-adpt/domain';
import { decisionWorkflowEventSubjects } from '@nestfolio/decision-workflow-ctrl/contracts';

/**
 * The single typed registry of `event detailType → producer subject schema`, composed
 * from each producer's own event-subject map (the producer remains the source of truth).
 * Each retrofit phase adds its domain's producer maps here. A typed fixture references
 * this registry so a missing/extra/mistyped subject field, an identity field in the
 * subject, or an unknown event name is a COMPILE error; `putEvent` also runs
 * `EventSubjects[detailType].parse(subject)` as a runtime backstop.
 */
export const EventSubjects = {
  ...mandateEventSubjects,
  ...decisionWorkflowEventSubjects,
} as const satisfies Record<string, ZodTypeAny>;

/** Union of all registered event names (detailTypes). */
export type RegisteredEventName = keyof typeof EventSubjects;

/** The DRY producer subject type for a registered event name. */
export type SubjectOf<K extends RegisteredEventName> = z.infer<(typeof EventSubjects)[K]>;
