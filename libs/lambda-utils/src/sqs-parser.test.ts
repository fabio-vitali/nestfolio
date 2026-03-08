import { SQSRecord } from 'aws-lambda';
import { parseRecord } from './sqs-parser';

// Import NotRetryableError from platform-core errors directly to avoid Highland type issues
import { NotRetryableError } from '@nestfolio/platform-core';

function buildSqsRecord(body: object): SQSRecord {
  return {
    messageId: 'msg-001',
    receiptHandle: 'receipt-handle',
    body: JSON.stringify(body),
    attributes: {
      ApproximateReceiveCount: '1',
      SentTimestamp: '1640000000000',
      SenderId: 'sender-id',
      ApproximateFirstReceiveTimestamp: '1640000000000',
    },
    messageAttributes: {},
    md5OfBody: 'md5',
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn:aws:sqs:us-east-1:123456789:test-queue',
    awsRegion: 'us-east-1',
  };
}

describe('parseRecord', () => {
  it('should parse an EventBridge-wrapped SQS record (detail field)', () => {
    const eventPayload = {
      id: 'evt-001',
      type: 'MANDATE_GRANTED',
      timestamp: '2025-01-01T00:00:00.000Z',
      subject: { mandateId: 'm-1', investorId: 'inv-1' },
      context: { tenantId: 'tenant-1' },
    };

    const sqsBody = {
      version: '0',
      id: 'eb-id-001',
      source: 'investor-hub@investor-svc',
      'detail-type': 'MANDATE_GRANTED',
      detail: eventPayload,
    };

    const record = buildSqsRecord(sqsBody);
    const result = parseRecord(record);

    expect(result.event).toEqual(eventPayload);
    expect(result.payload).toEqual({
      mandateId: 'm-1',
      investorId: 'inv-1',
    });
    expect(result.record).toBe(record);
  });

  it('should parse a raw SQS record (no detail wrapper)', () => {
    const rawEvent = {
      id: 'evt-002',
      type: 'GOAL_UPDATED',
      timestamp: '2025-02-01T00:00:00.000Z',
      subject: { goalId: 'g-1', amount: 50000 },
      context: { tenantId: 'tenant-2' },
    };

    const record = buildSqsRecord(rawEvent);
    const result = parseRecord(record);

    expect(result.event).toEqual(rawEvent);
    expect(result.payload).toEqual({ goalId: 'g-1', amount: 50000 });
    expect(result.record).toBe(record);
  });

  it('should support generic type parameter', () => {
    interface MandatePayload {
      mandateId: string;
      investorId: string;
    }

    const eventPayload = {
      id: 'evt-003',
      type: 'MANDATE_GRANTED',
      timestamp: '2025-03-01T00:00:00.000Z',
      subject: { mandateId: 'm-2', investorId: 'inv-2' },
      context: { tenantId: 'tenant-3' },
    };

    const record = buildSqsRecord({ detail: eventPayload });
    const result = parseRecord<MandatePayload>(record);

    expect(result.event.subject).toEqual({
      mandateId: 'm-2',
      investorId: 'inv-2',
    });
  });

  it('should throw NotRetryableError on invalid JSON body', () => {
    const record = buildSqsRecord({});
    record.body = 'not-json';

    expect(() => parseRecord(record)).toThrow(NotRetryableError);
    expect(() => parseRecord(record)).toThrow('Malformed SQS message body');
  });

  it('should include messageId in NotRetryableError details for malformed JSON', () => {
    const record = buildSqsRecord({});
    record.body = '{broken';

    try {
      parseRecord(record);
      fail('Expected NotRetryableError');
    } catch (err) {
      expect(err).toBeInstanceOf(NotRetryableError);
      expect((err as NotRetryableError).details).toEqual({ messageId: 'msg-001' });
    }
  });

  it('should throw NotRetryableError when event.subject is missing', () => {
    const record = buildSqsRecord({
      id: 'evt-missing',
      type: 'SOME_TYPE',
      timestamp: '2025-01-01T00:00:00.000Z',
      context: { tenantId: 'tenant-1' },
    });

    expect(() => parseRecord(record)).toThrow(NotRetryableError);
    expect(() => parseRecord(record)).toThrow('missing "subject" field');
  });

  it('should throw NotRetryableError when event.type is missing', () => {
    const record = buildSqsRecord({
      id: 'evt-no-type',
      subject: { foo: 'bar' },
      context: { tenantId: 'tenant-1' },
    });

    expect(() => parseRecord(record)).toThrow(NotRetryableError);
    expect(() => parseRecord(record)).toThrow('missing "type" field');
  });

  it('should throw NotRetryableError when context.tenantId is missing', () => {
    const record = buildSqsRecord({
      id: 'evt-no-tenant',
      type: 'SOME_TYPE',
      subject: { foo: 'bar' },
      context: {},
    });

    expect(() => parseRecord(record)).toThrow(NotRetryableError);
    expect(() => parseRecord(record)).toThrow('missing "context.tenantId" field');
  });

  it('should throw NotRetryableError when context is missing entirely', () => {
    const record = buildSqsRecord({
      id: 'evt-no-context',
      type: 'SOME_TYPE',
      subject: { foo: 'bar' },
    });

    expect(() => parseRecord(record)).toThrow(NotRetryableError);
    expect(() => parseRecord(record)).toThrow('missing "context.tenantId" field');
  });
});
