import type { KinesisStreamRecord } from 'aws-lambda';
import type { IngestionRecord } from './ingestion-types';
import type { BusEvent } from '../platform';
import { NotRetryableError } from '../internal';

export function parseKinesisRecord(kinesisRecord: KinesisStreamRecord): IngestionRecord {
  let body: Record<string, unknown>;
  try {
    const decoded = Buffer.from(kinesisRecord.kinesis.data, 'base64').toString('utf-8');
    body = JSON.parse(decoded);
  } catch {
    throw new NotRetryableError(
      'Malformed Kinesis record: unable to decode base64 or parse JSON',
      { sequenceNumber: kinesisRecord.kinesis.sequenceNumber },
    );
  }

  const event = (body.detail ?? body) as Record<string, unknown>;

  if (!event.subject) {
    throw new NotRetryableError(
      'Invalid event: missing "subject" field',
      { sequenceNumber: kinesisRecord.kinesis.sequenceNumber },
    );
  }

  if (!event.type) {
    throw new NotRetryableError(
      'Invalid event: missing "type" field',
      { sequenceNumber: kinesisRecord.kinesis.sequenceNumber },
    );
  }

  if (!(event.context as Record<string, unknown>)?.tenantId) {
    throw new NotRetryableError(
      'Invalid event: missing "context.tenantId" field',
      { sequenceNumber: kinesisRecord.kinesis.sequenceNumber },
    );
  }

  if (!(event.context as Record<string, unknown>)?.userId) {
    throw new NotRetryableError(
      'Invalid event: missing "context.userId" field',
      { sequenceNumber: kinesisRecord.kinesis.sequenceNumber },
    );
  }

  if (!(event.context as Record<string, unknown>)?.region) {
    throw new NotRetryableError(
      'Invalid event: missing "context.region" field',
      { sequenceNumber: kinesisRecord.kinesis.sequenceNumber },
    );
  }

  return {
    id: kinesisRecord.kinesis.sequenceNumber,
    event: event as BusEvent,
    metadata: {},
  };
}
