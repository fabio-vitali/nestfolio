import { SQSRecord } from 'aws-lambda';
import { BusEvent, UnitOfWork, NotRetryableError } from '@nestfolio/platform-core';

/**
 * Parses an SQS record into a UnitOfWork for pipeline processing.
 * Supports both EventBridge-wrapped events (with `detail` field) and raw events.
 */
export function parseRecord<T = Record<string, unknown>>(
  record: SQSRecord,
): UnitOfWork<BusEvent<T>> {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(record.body);
  } catch {
    throw new NotRetryableError(
      `Malformed SQS message body: unable to parse JSON`,
      { messageId: record.messageId },
    );
  }

  const event = (body.detail ?? body) as BusEvent<T>;

  if (!event.subject) {
    throw new NotRetryableError(
      `Invalid event: missing "subject" field`,
      { messageId: record.messageId },
    );
  }

  return { event, payload: event.subject as Record<string, unknown>, record };
}
