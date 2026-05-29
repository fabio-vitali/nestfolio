import type { UpdateIntent, KeyOverrides } from '../types/write-intent';
import type { RejectProjection } from '../types/ownership';

/**
 * Like update() but throws ConditionalCheckFailedException instead of
 * returning `{ success: true, deduplicated: true }` when the condition
 * fails. SQS will redrive the message until the precondition holds (or
 * maxReceiveCount is exhausted → DLQ).
 *
 * Use when the condition expresses a precondition that must hold for the
 * write to make sense — e.g., advisory-bff's status updates that should
 * wait for DECISION_PACKET_CREATED to land before applying.
 *
 * For the dedup / skip-if-not-X semantic, keep using update({condition}).
 *
 * @remarks Ownership enforcement requires a string-literal `typename`; a widened `string` bypasses it. See types/ownership.ts.
 */
export function updateOrRetry<K extends string>(
  typename: RejectProjection<K>,
  updates: Record<string, unknown>,
  options: {
    condition: string;
    removes?: string[];
    conditionNames?: Record<string, string>;
    conditionValues?: Record<string, unknown>;
    overrides?: KeyOverrides;
  },
): UpdateIntent {
  const name = typename as string;
  return {
    _tag: 'update',
    typename: name,
    updates,
    condition: options.condition,
    onConditionFail: 'retry',
    ...(options.removes ? { removes: options.removes } : {}),
    ...(options.conditionNames ? { conditionNames: options.conditionNames } : {}),
    ...(options.conditionValues ? { conditionValues: options.conditionValues } : {}),
    ...(options.overrides ? { overrides: options.overrides } : {}),
  };
}
