import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { IngestionEngine } from '../../src/engine/ingestion-engine';
import { record } from '../../src/intents/record';
import type { IngestionRecord } from '../../src/engine/ingestion-types';
import type { BusEvent } from '../../src/platform';

const ddbMock = mockClient(DynamoDBDocumentClient);
const ebMock = mockClient(EventBridgeClient);

jest.mock('../../src/internal', () => ({
  parseRecord: jest.fn((sqsRecord) => {
    const body = JSON.parse(sqsRecord.body);
    return { event: body.detail ?? body, payload: {}, record: sqsRecord };
  }),
  isRetryable: jest.fn((err: unknown) => !(err instanceof Error && 'notRetryable' in err && err.notRetryable)),
  NotRetryableError: class NotRetryableError extends Error { notRetryable = true; },
  createServiceMetrics: jest.fn(() => ({
    addMetric: jest.fn(),
    publishStoredMetrics: jest.fn(),
  })),
  traceEvent: jest.fn(),
  publishErrorEvent: jest.fn(),
  extractRequestContext: jest.fn(() => ({ tenantId: 'tenant-1', userId: 'test-user', region: 'us-east-1' })),
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
  getUUID: jest.fn(() => 'test-uuid'),
  getTime: jest.fn(() => '2026-01-01T00:00:00Z'),
  guardedWrite: jest.fn().mockResolvedValue(true),
}));

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function makeRecord(
  type: string,
  payload: Record<string, unknown>,
  opts?: { id?: string; receiveCount?: number },
): IngestionRecord {
  return {
    id: opts?.id ?? `msg-${Math.random().toString(36).slice(2)}`,
    event: {
      id: `evt-1`,
      type,
      timestamp: '2026-01-01T00:00:00Z',
      subject: payload,
      context: { tenantId: 'tenant-1', userId: 'test-user', region: 'us-east-1' },
    } as BusEvent,
    metadata: { receiveCount: opts?.receiveCount },
  };
}

describe('IngestionEngine', () => {
  beforeEach(() => {
    ddbMock.reset();
    ebMock.reset();
    ddbMock.on(PutCommand).resolves({});
    ebMock.on(PutEventsCommand).resolves({});
    jest.clearAllMocks();
  });

  it('routes records to correct handlers by event type, returns empty failures on success', async () => {
    const engine = new IngestionEngine({
      serviceName: 'test',
      handlers: {
        ORDER_FILLED: record('Entry', ({ subject }) => ({ amount: subject['amount'] })),
      },
      docClient,
      tableName: 'TestTable',
    });

    const records = [makeRecord('ORDER_FILLED', { amount: 100 }, { id: 'msg-0' })];
    const result = await engine.process(records);

    expect(result.failures).toEqual([]);
    expect(ddbMock).toHaveReceivedCommandTimes(PutCommand, 1);
  });

  it('skips unknown event types without error (records EventSkipped metric)', async () => {
    const engine = new IngestionEngine({
      serviceName: 'test',
      handlers: {
        ORDER_FILLED: record('Entry', ({ subject }) => subject),
      },
      docClient,
      tableName: 'TestTable',
    });

    const records = [makeRecord('UNKNOWN_TYPE', {}, { id: 'msg-0' })];
    const result = await engine.process(records);

    expect(result.failures).toEqual([]);
    expect(result.metrics.EventSkipped).toBe(1);
    expect(ddbMock).not.toHaveReceivedCommand(PutCommand);
  });

  it('collects retryable errors as failures in IngestionResult', async () => {
    ddbMock.on(PutCommand).rejectsOnce(new Error('timeout'));

    const engine = new IngestionEngine({
      serviceName: 'test',
      handlers: {
        ORDER_FILLED: record('Entry', ({ subject }) => subject),
      },
      docClient,
      tableName: 'TestTable',
    });

    const records = [makeRecord('ORDER_FILLED', {}, { id: 'msg-0' })];
    const result = await engine.process(records);

    expect(result.failures).toEqual(['msg-0']);
    expect(result.metrics.EventFailed).toBe(1);
  });

  it('drops non-retryable errors (records EventDropped metric, includes in droppedErrors)', async () => {
    const notRetryable = Object.assign(new Error('validation failed'), { notRetryable: true });
    ddbMock.on(PutCommand).rejectsOnce(notRetryable);

    const engine = new IngestionEngine({
      serviceName: 'test',
      handlers: {
        ORDER_FILLED: record('Entry', ({ subject }) => subject),
      },
      docClient,
      tableName: 'TestTable',
    });

    const records = [makeRecord('ORDER_FILLED', {}, { id: 'msg-0' })];
    const result = await engine.process(records);

    expect(result.failures).toEqual([]);
    expect(result.metrics.EventDropped).toBe(1);
    expect(result.droppedErrors).toHaveLength(1);
    expect(result.droppedErrors[0].error.message).toBe('validation failed');
  });

  it('processes multiple records with mixed outcomes (success + retryable + skipped)', async () => {
    ddbMock.on(PutCommand)
      .resolvesOnce({})          // msg-0: success
      .rejectsOnce(new Error('timeout')); // msg-1: retryable

    const engine = new IngestionEngine({
      serviceName: 'test',
      handlers: {
        ORDER_FILLED: record('Entry', ({ subject }) => subject),
      },
      docClient,
      tableName: 'TestTable',
    });

    const records = [
      makeRecord('ORDER_FILLED', { a: 1 }, { id: 'msg-0' }),
      makeRecord('ORDER_FILLED', { a: 2 }, { id: 'msg-1' }),
      makeRecord('UNKNOWN_TYPE', { a: 3 }, { id: 'msg-2' }),
    ];
    const result = await engine.process(records);

    expect(result.failures).toEqual(['msg-1']);
    expect(result.metrics.EventProcessed).toBe(1);
    expect(result.metrics.EventFailed).toBe(1);
    expect(result.metrics.EventSkipped).toBe(1);
  });

  it('records deduplication when IntentExecutor returns { deduplicated: true }', async () => {
    const condCheckError = new Error('ConditionalCheckFailedException');
    condCheckError.name = 'ConditionalCheckFailedException';
    ddbMock.on(PutCommand).rejectsOnce(condCheckError);

    const engine = new IngestionEngine({
      serviceName: 'test',
      handlers: {
        ORDER_FILLED: record('Entry', ({ subject }) => subject),
      },
      docClient,
      tableName: 'TestTable',
    });

    const records = [makeRecord('ORDER_FILLED', {}, { id: 'msg-0' })];
    const result = await engine.process(records);

    expect(result.failures).toEqual([]);
    expect(result.metrics.EventDeduplicated).toBe(1);
  });

  it('publishes non-retryable errors to EventBridge when busName is configured', async () => {
    const notRetryable = Object.assign(new Error('bad data'), { notRetryable: true });
    ddbMock.on(PutCommand).rejectsOnce(notRetryable);

    const engine = new IngestionEngine({
      serviceName: 'test',
      handlers: {
        ORDER_FILLED: record('Entry', ({ subject }) => subject),
      },
      docClient,
      tableName: 'TestTable',
      busName: 'my-bus',
    });

    const records = [makeRecord('ORDER_FILLED', {}, { id: 'msg-0' })];
    const result = await engine.process(records);

    // Non-retryable error must appear in droppedErrors and not in failures
    expect(result.droppedErrors).toHaveLength(1);
    expect(result.droppedErrors[0].error.message).toBe('bad data');
    expect(result.failures).toEqual([]);
    expect(result.metrics.EventDropped).toBe(1);
  });
});
