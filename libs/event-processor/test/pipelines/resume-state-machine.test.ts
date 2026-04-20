import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { SFNClient, SendTaskSuccessCommand, SendTaskFailureCommand } from '@aws-sdk/client-sfn';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { SQSEvent } from 'aws-lambda';
import { resumeStateMachine } from '../../src/pipelines/resume-state-machine';
import { record } from '../../src/intents/record';

const sfnMock = mockClient(SFNClient);
const ddbMock = mockClient(DynamoDBDocumentClient);

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
    extractRequestContext: jest.fn(() => ({ tenantId: 'tenant-1', userId: 'test-user', region: 'us-east-1' })),
    logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
    applyMiddleware: jest.fn((handler: unknown) => handler),
    withLambdaContext: jest.fn(() => (next: unknown) => next),
    withTiming: jest.fn(() => (next: unknown) => next),
    guardedWrite: jest.fn().mockResolvedValue(true),
  };
});

function makeSqsEvent(type: string, payload: Record<string, unknown>): SQSEvent {
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
      attributes: {
        ApproximateReceiveCount: '1',
        SentTimestamp: '',
        SenderId: '',
        ApproximateFirstReceiveTimestamp: '',
      },
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
    sfnMock.reset();
    ddbMock.reset();
    jest.clearAllMocks();
    sfnMock.on(SendTaskSuccessCommand).resolves({});
    sfnMock.on(SendTaskFailureCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});
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

    const result = await handler(makeSqsEvent('TEST_EVENT', { taskToken: 'token-123' }));

    expect(result.batchItemFailures).toHaveLength(0);
    expect(sfnMock).toHaveReceivedCommandWith(SendTaskSuccessCommand, {
      taskToken: 'token-123',
      output: expect.any(String),
    });
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

    const result = await handler(makeSqsEvent('TEST_EVENT', { taskToken: 'token-456' }));

    expect(result.batchItemFailures).toHaveLength(0);
    expect(sfnMock).toHaveReceivedCommand(SendTaskSuccessCommand);
    expect(ddbMock).toHaveReceivedCommand(PutCommand);
  });

  it('sends SendTaskFailureCommand on handler error', async () => {
    const handler = resumeStateMachine({
      serviceName: 'test-svc',
      handlers: {
        TEST_EVENT: async () => { throw new Error('agent failed'); },
      },
    });

    const result = await handler(makeSqsEvent('TEST_EVENT', { taskToken: 'token-789' }));

    // error = short code (err.name), cause = long description (err.message).
    // The previous order violated the SendTaskFailure 256-char cap on `error`
    // when err.message was long (e.g. full AccessDeniedException text).
    expect(sfnMock).toHaveReceivedCommandWith(SendTaskFailureCommand, {
      taskToken: 'token-789',
      error: 'Error',
      cause: 'agent failed',
    });
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

    const result = await handler(makeSqsEvent('TEST_EVENT', { noToken: true }));

    // Should NOT have called SFN
    expect(sfnMock).not.toHaveReceivedCommand(SendTaskSuccessCommand);
    expect(sfnMock).not.toHaveReceivedCommand(SendTaskFailureCommand);
    // NotRetryableError = drop, not retry — batchItemFailures empty
    expect(result.batchItemFailures).toHaveLength(0);
  });

  it('serializes output to JSON string in SendTaskSuccessCommand', async () => {
    const handler = resumeStateMachine({
      serviceName: 'test-svc',
      handlers: {
        TEST_EVENT: async () => ({
          output: { score: 42, label: 'high' },
        }),
      },
    });

    await handler(makeSqsEvent('TEST_EVENT', { taskToken: 'tok-ser' }));

    expect(sfnMock).toHaveReceivedCommandWith(SendTaskSuccessCommand, {
      taskToken: 'tok-ser',
      output: JSON.stringify({ score: 42, label: 'high' }),
    });
  });

  it('treats SendTaskSuccess TaskTimedOut as success (duplicate event)', async () => {
    const taskTimedOut = new Error('Task already closed');
    taskTimedOut.name = 'TaskTimedOut';
    sfnMock.on(SendTaskSuccessCommand).rejects(taskTimedOut);

    const handler = resumeStateMachine({
      serviceName: 'test-svc',
      handlers: {
        TEST_EVENT: async () => ({ output: { result: 'ok' } }),
      },
    });

    const result = await handler(makeSqsEvent('TEST_EVENT', { taskToken: 'tok-dup-1' }));

    // Lambda should succeed — no batch item failure, no SendTaskFailure call
    expect(result.batchItemFailures).toHaveLength(0);
    expect(sfnMock).not.toHaveReceivedCommand(SendTaskFailureCommand);
  });

  it('treats SendTaskSuccess InvalidToken as success (duplicate event)', async () => {
    const invalidToken = new Error('Invalid token');
    invalidToken.name = 'InvalidToken';
    sfnMock.on(SendTaskSuccessCommand).rejects(invalidToken);

    const handler = resumeStateMachine({
      serviceName: 'test-svc',
      handlers: {
        TEST_EVENT: async () => ({ output: { result: 'ok' } }),
      },
    });

    const result = await handler(makeSqsEvent('TEST_EVENT', { taskToken: 'tok-dup-2' }));

    expect(result.batchItemFailures).toHaveLength(0);
    expect(sfnMock).not.toHaveReceivedCommand(SendTaskFailureCommand);
  });

  it('treats SendTaskSuccess TaskDoesNotExist as success (duplicate event)', async () => {
    const taskGone = new Error('Task does not exist');
    taskGone.name = 'TaskDoesNotExist';
    sfnMock.on(SendTaskSuccessCommand).rejects(taskGone);

    const handler = resumeStateMachine({
      serviceName: 'test-svc',
      handlers: {
        TEST_EVENT: async () => ({ output: { result: 'ok' } }),
      },
    });

    const result = await handler(makeSqsEvent('TEST_EVENT', { taskToken: 'tok-dup-3' }));

    expect(result.batchItemFailures).toHaveLength(0);
    expect(sfnMock).not.toHaveReceivedCommand(SendTaskFailureCommand);
  });

  it('still propagates other SendTaskSuccess errors', async () => {
    const otherError = new Error('something else broke');
    otherError.name = 'KmsAccessDeniedException';
    sfnMock.on(SendTaskSuccessCommand).rejects(otherError);

    const handler = resumeStateMachine({
      serviceName: 'test-svc',
      handlers: {
        TEST_EVENT: async () => ({ output: { result: 'ok' } }),
      },
    });

    const result = await handler(makeSqsEvent('TEST_EVENT', { taskToken: 'tok-real-failure' }));

    // Real error should fall through to the outer catch → SendTaskFailure → retryable
    expect(sfnMock).toHaveReceivedCommand(SendTaskFailureCommand);
    expect(result.batchItemFailures).toHaveLength(1);
  });
});
