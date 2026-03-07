import { SQSRecord } from 'aws-lambda';
import { BusEvent, UnitOfWork } from '@nestfolio/platform-core';

/**
 * Parses an SQS record into a UnitOfWork for pipeline processing.
 * Supports both EventBridge-wrapped events (with `detail` field) and raw events.
 */
export function parseRecord<T = Record<string, unknown>>(
  record: SQSRecord,
): UnitOfWork<BusEvent<T>> {
  const body = JSON.parse(record.body);
  const event: BusEvent<T> = body.detail ?? body;
  return { event, payload: event.subject as Record<string, unknown>, record };
}
