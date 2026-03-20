import { BatchEngine } from '../../src/engine/batch-engine';
import { record } from '../../src/intents/record';
import type { SQSEvent } from 'aws-lambda';

// Minimal mock of internal utilities
jest.mock('../../src/internal', () => ({
  parseRecord: jest.fn((sqsRecord) => {
    const body = JSON.parse(sqsRecord.body);
    return { event: body.detail ?? body, payload: {}, record: sqsRecord };
  }),
  isRetryable: jest.fn((err) => !(err as any).notRetryable),
  NotRetryableError: class NotRetryableError extends Error { notRetryable = true; },
  createServiceMetrics: jest.fn(() => ({
    addMetric: jest.fn(),
    publishStoredMetrics: jest.fn(),
  })),
  traceEvent: jest.fn(),
  publishErrorEvent: jest.fn(),
  extractTenantId: jest.fn(() => 'tenant-1'),
}));

function makeSqsEvent(records: Array<{ type: string; payload: Record<string, unknown>; receiveCount?: number }>): SQSEvent {
  return {
    Records: records.map((r, i) => ({
      messageId: `msg-${i}`,
      body: JSON.stringify({ detail: { id: `evt-${i}`, type: r.type, timestamp: '2026-01-01T00:00:00Z', subject: r.payload, context: { tenantId: 'tenant-1' } } }),
      attributes: { ApproximateReceiveCount: String(r.receiveCount ?? 1) } as any,
      messageAttributes: {},
      md5OfBody: '',
      eventSource: 'aws:sqs',
      eventSourceARN: '',
      awsRegion: 'us-east-1',
      receiptHandle: '',
    })),
  };
}

describe('BatchEngine', () => {
  let mockDocClient: any;

  beforeEach(() => {
    mockDocClient = { send: jest.fn().mockResolvedValue({}) };
    jest.clearAllMocks();
  });

  it('processes records and returns empty batchItemFailures on success', async () => {
    const engine = new BatchEngine({
      serviceName: 'test',
      handlers: {
        ORDER_FILLED: record('Entry', ({ subject }) => ({ amount: subject.amount })),
      },
      docClient: mockDocClient,
      tableName: 'TestTable',
    });

    const event = makeSqsEvent([{ type: 'ORDER_FILLED', payload: { amount: 100 } }]);
    const result = await engine.process(event);

    expect(result.batchItemFailures).toEqual([]);
    expect(mockDocClient.send).toHaveBeenCalledTimes(1);
  });

  it('skips unknown event types without error', async () => {
    const engine = new BatchEngine({
      serviceName: 'test',
      handlers: { ORDER_FILLED: record('Entry', ({ subject }) => subject) },
      docClient: mockDocClient,
      tableName: 'TestTable',
    });

    const event = makeSqsEvent([{ type: 'UNKNOWN_TYPE', payload: {} }]);
    const result = await engine.process(event);

    expect(result.batchItemFailures).toEqual([]);
    expect(mockDocClient.send).not.toHaveBeenCalled();
  });

  it('collects retryable errors as batchItemFailures', async () => {
    mockDocClient.send.mockRejectedValueOnce(new Error('timeout'));

    const engine = new BatchEngine({
      serviceName: 'test',
      handlers: { ORDER_FILLED: record('Entry', ({ subject }) => subject) },
      docClient: mockDocClient,
      tableName: 'TestTable',
    });

    const event = makeSqsEvent([{ type: 'ORDER_FILLED', payload: {} }]);
    const result = await engine.process(event);

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'msg-0' }]);
  });

  it('skips poison pills (receiveCount > max)', async () => {
    const engine = new BatchEngine({
      serviceName: 'test',
      handlers: { ORDER_FILLED: record('Entry', ({ subject }) => subject) },
      docClient: mockDocClient,
      tableName: 'TestTable',
      poisonPillMaxReceiveCount: 3,
    });

    const event = makeSqsEvent([{ type: 'ORDER_FILLED', payload: {}, receiveCount: 5 }]);
    const result = await engine.process(event);

    expect(result.batchItemFailures).toEqual([]);
    expect(mockDocClient.send).not.toHaveBeenCalled();
  });

  it('processes multiple records with mixed outcomes', async () => {
    mockDocClient.send
      .mockResolvedValueOnce({})       // msg-0 success
      .mockRejectedValueOnce(new Error('timeout'))  // msg-1 retryable error
      .mockResolvedValueOnce({});      // msg-2 success

    const engine = new BatchEngine({
      serviceName: 'test',
      handlers: { ORDER_FILLED: record('Entry', ({ subject }) => subject) },
      docClient: mockDocClient,
      tableName: 'TestTable',
    });

    const event = makeSqsEvent([
      { type: 'ORDER_FILLED', payload: { a: 1 } },
      { type: 'ORDER_FILLED', payload: { a: 2 } },
      { type: 'ORDER_FILLED', payload: { a: 3 } },
    ]);
    const result = await engine.process(event);

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'msg-1' }]);
  });
});
