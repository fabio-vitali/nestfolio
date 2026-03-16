import type { SQSRecord } from 'aws-lambda';
import { NotRetryableError } from './errors';

/**
 * Base event type — all events in the system extend this.
 */
type Event = {
  id: string;
  type: string;
  timestamp: string;
};

/**
 * BusEvent — domain event published to EventBridge.
 */
type BusEvent<T = object, S = Record<string, unknown>> = Event & {
  subject: T;
  context: S;
};

/**
 * UnitOfWork — wraps an event with its parsed payload and raw record.
 */
type UnitOfWork<T = Event, R = unknown> = {
  event: T;
  payload: Record<string, unknown>;
  record: R;
  batch?: UnitOfWork<T, R>[];
};

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

  if (!event.type) {
    throw new NotRetryableError(
      `Invalid event: missing "type" field`,
      { messageId: record.messageId },
    );
  }

  if (!event.context?.tenantId) {
    throw new NotRetryableError(
      `Invalid event: missing "context.tenantId" field`,
      { messageId: record.messageId },
    );
  }

  return { event, payload: event.subject as Record<string, unknown>, record };
}
