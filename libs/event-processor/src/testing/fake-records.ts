import type { SQSRecord, DynamoDBRecord } from 'aws-lambda';
import { randomUUID } from 'crypto';

export function fakeSqsRecord(
  eventType: string,
  payload: Record<string, unknown>,
  opts?: { eventId?: string; tenantId?: string; receiveCount?: number },
): SQSRecord {
  const eventId = opts?.eventId ?? randomUUID();
  const tenantId = opts?.tenantId ?? 'test-tenant';

  return {
    messageId: randomUUID(),
    receiptHandle: '',
    body: JSON.stringify({
      detail: {
        id: eventId,
        type: eventType,
        timestamp: new Date().toISOString(),
        subject: payload,
        context: { tenantId },
      },
    }),
    attributes: {
      ApproximateReceiveCount: String(opts?.receiveCount ?? 1),
      SentTimestamp: '',
      SenderId: '',
      ApproximateFirstReceiveTimestamp: '',
    },
    messageAttributes: {},
    md5OfBody: '',
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn:aws:sqs:us-east-1:000000000000:test-queue',
    awsRegion: 'us-east-1',
  };
}

export function fakeDdbStreamRecord(
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE',
  newImage: Record<string, unknown>,
  opts?: { oldImage?: Record<string, unknown> },
): DynamoDBRecord {
  return {
    eventID: randomUUID(),
    eventName,
    eventVersion: '1.1',
    eventSource: 'aws:dynamodb',
    awsRegion: 'us-east-1',
    dynamodb: {
      Keys: {
        pk: { S: newImage.pk as string ?? 'pk-1' },
        sk: { S: newImage.sk as string ?? 'sk-1' },
      },
      NewImage: eventName !== 'REMOVE' ? toAttributeMap(newImage) : undefined,
      OldImage: opts?.oldImage ? toAttributeMap(opts.oldImage) : (eventName === 'REMOVE' ? toAttributeMap(newImage) : undefined),
      StreamViewType: 'NEW_AND_OLD_IMAGES',
      SequenceNumber: '1',
      SizeBytes: 100,
    },
    eventSourceARN: 'arn:aws:dynamodb:us-east-1:000000000000:table/test/stream/2026-01-01',
  };
}

function toAttributeMap(obj: Record<string, unknown>): Record<string, any> {
  const map: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') map[key] = { S: value };
    else if (typeof value === 'number') map[key] = { N: String(value) };
    else if (typeof value === 'boolean') map[key] = { BOOL: value };
    else if (value === null || value === undefined) map[key] = { NULL: true };
    else map[key] = { S: JSON.stringify(value) };
  }
  return map;
}
