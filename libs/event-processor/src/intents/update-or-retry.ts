import type { UpdateIntent, KeyOverrides } from '../types/write-intent';

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
 */
export function updateOrRetry(
  typename: string,
  updates: Record<string, unknown>,
  options: {
    condition: string;
    removes?: string[];
    conditionNames?: Record<string, string>;
    conditionValues?: Record<string, unknown>;
    overrides?: KeyOverrides;
  },
): UpdateIntent {
  return {
    _tag: 'update',
    typename,
    updates,
    condition: options.condition,
    onConditionFail: 'retry',
    ...(options.removes ? { removes: options.removes } : {}),
    ...(options.conditionNames ? { conditionNames: options.conditionNames } : {}),
    ...(options.conditionValues ? { conditionValues: options.conditionValues } : {}),
    ...(options.overrides ? { overrides: options.overrides } : {}),
  };
}
