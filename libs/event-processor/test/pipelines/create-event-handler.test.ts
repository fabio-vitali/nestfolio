import { createEventHandler } from '../../src/pipelines/create-event-handler';
import { record } from '../../src/intents/record';

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
}));

function makeSqsEvent(type: string, payload: Record<string, unknown>) {
  return {
    Records: [{
      messageId: 'msg-1',
      body: JSON.stringify({ detail: { id: 'evt-1', type, timestamp: '2026-01-01T00:00:00Z', subject: payload, context: { tenantId: 'tenant-1' } } }),
      attributes: { ApproximateReceiveCount: '1' } as any,
      messageAttributes: {}, md5OfBody: '', eventSource: 'aws:sqs', eventSourceARN: '', awsRegion: 'us-east-1', receiptHandle: '',
    }],
  };
}

describe('createEventHandler()', () => {
  it('returns a Lambda handler function', () => {
    const handler = createEventHandler({
      serviceName: 'test',
      handlers: { TEST: record('Entry', ({ subject }) => subject) },
      table: { name: 'T', client: { send: jest.fn().mockResolvedValue({}) } as any },
    });
    expect(typeof handler).toBe('function');
  });

  it('processes events and returns SQSBatchResponse', async () => {
    const handler = createEventHandler({
      serviceName: 'test',
      handlers: { ORDER_FILLED: record('Entry', ({ subject }) => ({ a: subject.a })) },
      table: { name: 'T', client: { send: jest.fn().mockResolvedValue({}) } as any },
    });

    const result = await handler(makeSqsEvent('ORDER_FILLED', { a: 1 }));
    expect(result.batchItemFailures).toEqual([]);
  });
});
