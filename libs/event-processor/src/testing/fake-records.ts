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
  opts?: {
    oldImage?: Record<string, unknown>;
    typename?: string;
    tenantId?: string;
    sequenceNo?: number;
  },
): DynamoDBRecord {
  const image = { ...newImage };
  if (opts?.typename && !image.__typename) image.__typename = opts.typename;
  if (opts?.tenantId && !image.tenantId) image.tenantId = opts.tenantId;
  if (opts?.sequenceNo != null && image.sequenceNo == null) image.sequenceNo = opts.sequenceNo;
  if (!image.pk) image.pk = `T#${image.tenantId ?? 'test-tenant'}`;
  if (!image.sk) image.sk = `${image.__typename ?? 'Unknown'}#${randomUUID()}`;

  return {
    eventID: randomUUID(),
    eventName,
    eventVersion: '1.1',
    eventSource: 'aws:dynamodb',
    awsRegion: 'us-east-1',
    dynamodb: {
      Keys: {
        pk: { S: image.pk as string },
        sk: { S: image.sk as string },
      },
      NewImage: eventName !== 'REMOVE' ? toAttributeMap(image) : undefined,
      OldImage: opts?.oldImage ? toAttributeMap(opts.oldImage) : (eventName === 'REMOVE' ? toAttributeMap(image) : undefined),
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
