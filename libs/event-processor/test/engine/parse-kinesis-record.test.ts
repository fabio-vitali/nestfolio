import { parseKinesisRecord } from '../../src/engine/parse-kinesis-record';
import type { KinesisStreamRecord } from 'aws-lambda';

function fakeKinesisRecord(event: Record<string, unknown>, opts?: { sequenceNumber?: string }): KinesisStreamRecord {
  const data = Buffer.from(JSON.stringify(event)).toString('base64');
  return {
    kinesis: {
      kinesisSchemaVersion: '1.0',
      partitionKey: 'pk-1',
      sequenceNumber: opts?.sequenceNumber ?? '123456',
      data,
      approximateArrivalTimestamp: Date.now() / 1000,
    },
    eventSource: 'aws:kinesis',
    eventVersion: '1.0',
    eventID: 'shardId-000:123456',
    eventName: 'aws:kinesis:record',
    invokeIdentityArn: 'arn:aws:iam::role/test',
    awsRegion: 'us-east-1',
    eventSourceARN: 'arn:aws:kinesis:us-east-1:000:stream/test',
  };
}

describe('parseKinesisRecord', () => {
  it('decodes base64 data into an IngestionRecord', () => {
    const busEvent = { id: 'evt-1', type: 'ORDER_FILLED', timestamp: '2026-01-01T00:00:00Z', subject: { amount: 100 }, context: { tenantId: 't1' } };
    const record = fakeKinesisRecord(busEvent, { sequenceNumber: 'seq-99' });
    const result = parseKinesisRecord(record);

    expect(result.id).toBe('seq-99');
    expect(result.event.type).toBe('ORDER_FILLED');
    expect(result.event.subject).toEqual({ amount: 100 });
    expect(result.metadata.receiveCount).toBeUndefined();
  });

  it('handles EventBridge-wrapped events (detail field)', () => {
    const wrapped = { detail: { id: 'evt-1', type: 'TEST', timestamp: 'now', subject: { a: 1 }, context: { tenantId: 't1' } } };
    const record = fakeKinesisRecord(wrapped);
    const result = parseKinesisRecord(record);

    expect(result.event.type).toBe('TEST');
    expect(result.event.subject).toEqual({ a: 1 });
  });

  it('throws NotRetryableError on malformed base64/JSON', () => {
    const record = fakeKinesisRecord({});
    record.kinesis.data = 'not-valid-base64!!!';

    expect(() => parseKinesisRecord(record)).toThrow('Malformed Kinesis record');
  });

  it('throws NotRetryableError when subject is missing', () => {
    const record = fakeKinesisRecord({ id: '1', type: 'T', timestamp: 'now', context: { tenantId: 't1' } });
    expect(() => parseKinesisRecord(record)).toThrow('missing "subject"');
  });

  it('throws NotRetryableError when type is missing', () => {
    const record = fakeKinesisRecord({ id: '1', timestamp: 'now', subject: {}, context: { tenantId: 't1' } });
    expect(() => parseKinesisRecord(record)).toThrow('missing "type"');
  });
});
