import { resumeStateMachine } from '../../src/pipelines/resume-state-machine';
import { record } from '../../src/intents/record';

const mockSfnSend = jest.fn().mockResolvedValue({});

jest.mock('@aws-sdk/client-sfn', () => ({
  SFNClient: jest.fn(() => ({ send: mockSfnSend })),
  SendTaskSuccessCommand: jest.fn((input: unknown) => ({ input, __type: 'SendTaskSuccessCommand' })),
  SendTaskFailureCommand: jest.fn((input: unknown) => ({ input, __type: 'SendTaskFailureCommand' })),
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

const mockDocSend = jest.fn().mockResolvedValue({});
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockDocSend })) },
  PutCommand: jest.fn((input: unknown) => ({ input })),
  UpdateCommand: jest.fn((input: unknown) => ({ input })),
}));

jest.mock('../../src/internal', () => {
  class _NotRetryableError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'NotRetryableError';
    }
  }
  return {
    parseRecord: jest.fn((sqsRecord: { body: string }) => {
      const body = JSON.parse(sqsRecord.body);
      return { event: body.detail ?? body, payload: {}, record: sqsRecord };
    }),
    isRetryable: jest.fn((error: unknown) => !(error instanceof _NotRetryableError)),
    NotRetryableError: _NotRetryableError,
    createServiceMetrics: jest.fn(() => ({ addMetric: jest.fn(), publishStoredMetrics: jest.fn() })),
    traceEvent: jest.fn(),
    publishErrorEvent: jest.fn(),
    extractTenantId: jest.fn(() => 'tenant-1'),
    extractRequestContext: jest.fn(() => ({ tenantId: 'tenant-1', userId: 'test-user', region: 'us-east-1' })),
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
    applyMiddleware: jest.fn((handler: unknown) => handler),
    withLambdaContext: jest.fn(() => (next: unknown) => next),
    withTiming: jest.fn(() => (next: unknown) => next),
  };
});

function makeSqsEvent(type: string, payload: Record<string, unknown>) {
  return {
    Records: [{
      messageId: 'msg-1',
      body: JSON.stringify({
        detail: {
          id: 'evt-1',
          type,
          timestamp: '2026-01-01T00:00:00Z',
          subject: payload,
          context: { tenantId: 'tenant-1', userId: 'test-user', region: 'us-east-1' },
        },
      }),
      attributes: { ApproximateReceiveCount: '1' } as Record<string, string>,
      messageAttributes: {},
      md5OfBody: '',
      eventSource: 'aws:sqs',
      eventSourceARN: '',
      awsRegion: 'us-east-1',
      receiptHandle: '',
    }],
  };
}

describe('resumeStateMachine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TABLE_NAME = 'test-table';
    process.env.BUS_NAME = 'test-bus';
  });

  afterEach(() => {
    delete process.env.TABLE_NAME;
    delete process.env.BUS_NAME;
  });

  it('returns a handler function', () => {
    const handler = resumeStateMachine({
      serviceName: 'test-svc',
      handlers: {
        TEST_EVENT: async () => ({ output: { ok: true } }),
      },
    });
    expect(typeof handler).toBe('function');
  });

  it('calls handler and sends SendTaskSuccessCommand', async () => {
    const handler = resumeStateMachine({
      serviceName: 'test-svc',
      handlers: {
        TEST_EVENT: async () => ({
          output: { result: 'ok' },
        }),
      },
    });

    const result = await handler(makeSqsEvent('TEST_EVENT', { taskToken: 'token-123' }) as any);

    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockSfnSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ taskToken: 'token-123' }),
      }),
    );
  });

  it('executes returned intents via engine', async () => {
    const handler = resumeStateMachine({
      serviceName: 'test-svc',
      handlers: {
        TEST_EVENT: async () => ({
          output: { done: true },
          intents: [record('TestRecord', { foo: 'bar' })],
        }),
      },
    });

    const result = await handler(makeSqsEvent('TEST_EVENT', { taskToken: 'token-456' }) as any);

    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockSfnSend).toHaveBeenCalled();
    expect(mockDocSend).toHaveBeenCalled();
  });

  it('sends SendTaskFailureCommand on handler error', async () => {
    const handler = resumeStateMachine({
      serviceName: 'test-svc',
      handlers: {
        TEST_EVENT: async () => { throw new Error('agent failed'); },
      },
    });

    const result = await handler(makeSqsEvent('TEST_EVENT', { taskToken: 'token-789' }) as any);

    expect(mockSfnSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          taskToken: 'token-789',
          error: 'agent failed',
        }),
      }),
    );
    // Error is retryable by default, so record appears in failures
    expect(result.batchItemFailures).toHaveLength(1);
  });

  it('drops message when taskToken is missing (NotRetryableError)', async () => {
    const handler = resumeStateMachine({
      serviceName: 'test-svc',
      handlers: {
        TEST_EVENT: async () => ({ output: { ok: true } }),
      },
    });

    const result = await handler(makeSqsEvent('TEST_EVENT', { noToken: true }) as any);

    // Should NOT have called SFN
    expect(mockSfnSend).not.toHaveBeenCalled();
    // NotRetryableError = drop, not retry — batchItemFailures empty
    expect(result.batchItemFailures).toHaveLength(0);
  });

  it('serializes output to JSON string in SendTaskSuccessCommand', async () => {
    const { SendTaskSuccessCommand } = jest.requireMock('@aws-sdk/client-sfn');

    const handler = resumeStateMachine({
      serviceName: 'test-svc',
      handlers: {
        TEST_EVENT: async () => ({
          output: { score: 42, label: 'high' },
        }),
      },
    });

    await handler(makeSqsEvent('TEST_EVENT', { taskToken: 'tok-ser' }) as any);

    expect(SendTaskSuccessCommand).toHaveBeenCalledWith({
      taskToken: 'tok-ser',
      output: JSON.stringify({ score: 42, label: 'high' }),
    });
  });
});
