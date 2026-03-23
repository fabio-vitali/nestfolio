import { createIngestionHandler } from '../../src/engine/create-ingestion-handler';
import { record } from '../../src/intents/record';
import { fakeSqsRecord, fakeKinesisRecord } from '../../src/testing/fake-records';

jest.mock('../../src/internal', () => ({
  parseRecord: jest.fn((sqsRecord) => {
    const body = JSON.parse(sqsRecord.body);
    return { event: body.detail ?? body, payload: {}, record: sqsRecord };
  }),
  isRetryable: jest.fn(() => true),
  NotRetryableError: class extends Error {},
  createServiceMetrics: jest.fn(() => ({ addMetric: jest.fn(), publishStoredMetrics: jest.fn() })),
  traceEvent: jest.fn(),
  publishErrorEvent: jest.fn(),
  extractTenantId: jest.fn(() => 'tenant-1'),
  applyMiddleware: jest.fn((handler) => handler),
  withLambdaContext: jest.fn(() => (next: any) => next),
  withTiming: jest.fn(() => (next: any) => next),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  getUUID: jest.fn(() => 'test-uuid'),
  getTime: jest.fn(() => '2026-01-01T00:00:00Z'),
  guardedWrite: jest.fn(),
}));

function makeSqsEvent(type: string, payload: Record<string, unknown>) {
  return { Records: [fakeSqsRecord(type, payload)] };
}

function makeKinesisEvent(type: string, payload: Record<string, unknown>) {
  return { Records: [fakeKinesisRecord(type, payload)] };
}

const mockClient = { send: jest.fn().mockResolvedValue({}) } as any;

describe('createIngestionHandler()', () => {
  it('returns a function when transport is sqs (default)', () => {
    const handler = createIngestionHandler({
      serviceName: 'test',
      handlers: { TEST: record('Entry', ({ subject }) => subject) },
      table: { name: 'T', client: mockClient },
    });
    expect(typeof handler).toBe('function');
  });

  it('returns a function when transport is kinesis', () => {
    const handler = createIngestionHandler({
      transport: 'kinesis',
      serviceName: 'test',
      handlers: { TEST: record('Entry', ({ subject }) => subject) },
      table: { name: 'T', client: mockClient },
    });
    expect(typeof handler).toBe('function');
  });

  it('SQS path: processes SQSEvent and returns SQSBatchResponse with empty batchItemFailures', async () => {
    const handler = createIngestionHandler({
      serviceName: 'test',
      handlers: { ORDER_FILLED: record('Entry', ({ subject }) => ({ a: subject['a'] })) },
      table: { name: 'T', client: mockClient },
    });

    const result = await handler(makeSqsEvent('ORDER_FILLED', { a: 1 }));
    expect(result.batchItemFailures).toEqual([]);
  });

  it('Kinesis path: processes KinesisStreamEvent and returns KinesisStreamBatchResponse with empty batchItemFailures', async () => {
    const handler = createIngestionHandler({
      transport: 'kinesis',
      serviceName: 'test',
      handlers: { ORDER_FILLED: record('Entry', ({ subject }) => ({ a: subject['a'] })) },
      table: { name: 'T', client: mockClient },
    });

    const result = await handler(makeKinesisEvent('ORDER_FILLED', { a: 1 }));
    expect(result.batchItemFailures).toEqual([]);
  });

  it('SQS path: retryable error returns batchItemFailures with messageId', async () => {
    const sqsRecord = fakeSqsRecord('FAIL', { x: 1 });
    const event = { Records: [sqsRecord] };

    const handler = createIngestionHandler({
      serviceName: 'test',
      handlers: {
        FAIL: async () => {
          throw new Error('fail');
        },
      },
      table: { name: 'T', client: mockClient },
    });

    const result = await handler(event);
    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0].itemIdentifier).toBe(sqsRecord.messageId);
  });

  it('Kinesis path: retryable error returns batchItemFailures with sequenceNumber', async () => {
    const sequenceNumber = 'seq-001';
    const kinesisRecord = fakeKinesisRecord('FAIL', { x: 1 }, { sequenceNumber });
    const event = { Records: [kinesisRecord] };

    const handler = createIngestionHandler({
      transport: 'kinesis',
      serviceName: 'test',
      handlers: {
        FAIL: async () => {
          throw new Error('fail');
        },
      },
      table: { name: 'T', client: mockClient },
    });

    const result = await handler(event);
    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0].itemIdentifier).toBe(sequenceNumber);
  });
});
