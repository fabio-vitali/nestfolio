import { parseSqsRecord } from '../../src/engine/parse-sqs-record';
import { fakeSqsRecord } from '../../src/testing/fake-records';

describe('parseSqsRecord', () => {
  it('parses a valid SQS record into an IngestionRecord', () => {
    const sqsRecord = fakeSqsRecord('ORDER_FILLED', { amount: 100 }, { tenantId: 'tenant-1', receiveCount: 2 });
    const result = parseSqsRecord(sqsRecord);

    expect(result.id).toBe(sqsRecord.messageId);
    expect(result.event.type).toBe('ORDER_FILLED');
    expect(result.event.subject).toEqual({ amount: 100 });
    expect(result.event.context).toEqual({ tenantId: 'tenant-1', userId: 'test-user', region: 'us-east-1' });
    expect(result.metadata.receiveCount).toBe(2);
  });

  it('parses an EventBridge-wrapped record (detail field)', () => {
    const sqsRecord = fakeSqsRecord('DEPOSIT_INITIATED', { currency: 'USD' });
    const result = parseSqsRecord(sqsRecord);

    expect(result.event.type).toBe('DEPOSIT_INITIATED');
    expect(result.event.subject).toEqual({ currency: 'USD' });
  });

  it('defaults receiveCount to 1 when not provided', () => {
    const sqsRecord = fakeSqsRecord('TEST', {});
    sqsRecord.attributes.ApproximateReceiveCount = '';
    const result = parseSqsRecord(sqsRecord);

    expect(result.metadata.receiveCount).toBe(1);
  });

  it('throws NotRetryableError on malformed JSON', () => {
    const sqsRecord = fakeSqsRecord('TEST', {});
    sqsRecord.body = 'not json';

    expect(() => parseSqsRecord(sqsRecord)).toThrow('Malformed SQS message body');
  });

  it('throws NotRetryableError when subject is missing', () => {
    const sqsRecord = fakeSqsRecord('TEST', {});
    sqsRecord.body = JSON.stringify({ detail: { id: '1', type: 'T', timestamp: 'now', context: { tenantId: 't1', userId: 'test-user', region: 'us-east-1' } } });

    expect(() => parseSqsRecord(sqsRecord)).toThrow('missing "subject"');
  });

  it('throws NotRetryableError when type is missing', () => {
    const sqsRecord = fakeSqsRecord('TEST', {});
    sqsRecord.body = JSON.stringify({ detail: { id: '1', timestamp: 'now', subject: {}, context: { tenantId: 't1', userId: 'test-user', region: 'us-east-1' } } });

    expect(() => parseSqsRecord(sqsRecord)).toThrow('missing "type"');
  });
});
