import type { SQSRecord } from 'aws-lambda';
import type { IngestionRecord } from './ingestion-types';
import { NotRetryableError } from '../internal';

export function parseSqsRecord(sqsRecord: SQSRecord): IngestionRecord {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(sqsRecord.body);
  } catch {
    throw new NotRetryableError(
      'Malformed SQS message body: unable to parse JSON',
      { messageId: sqsRecord.messageId },
    );
  }

  const event = (body.detail ?? body) as Record<string, unknown>;

  if (!event.subject) {
    throw new NotRetryableError(
      'Invalid event: missing "subject" field',
      { messageId: sqsRecord.messageId },
    );
  }

  if (!event.type) {
    throw new NotRetryableError(
      'Invalid event: missing "type" field',
      { messageId: sqsRecord.messageId },
    );
  }

  if (!(event.context as Record<string, unknown>)?.tenantId) {
    throw new NotRetryableError(
      'Invalid event: missing "context.tenantId" field',
      { messageId: sqsRecord.messageId },
    );
  }

  if (!(event.context as Record<string, unknown>)?.userId) {
    throw new NotRetryableError(
      'Invalid event: missing "context.userId" field',
      { messageId: sqsRecord.messageId },
    );
  }

  if (!(event.context as Record<string, unknown>)?.region) {
    throw new NotRetryableError(
      'Invalid event: missing "context.region" field',
      { messageId: sqsRecord.messageId },
    );
  }

  const receiveCount = parseInt(sqsRecord.attributes?.ApproximateReceiveCount ?? '1', 10) || 1;

  return {
    id: sqsRecord.messageId,
    event: event as any,
    metadata: { receiveCount },
  };
}
