import { StreamEngine } from '../../src/engine/stream-engine';
import { fakeDdbStreamRecord } from '../../src/testing/fake-records';
import type { DynamoDBStreamEvent } from 'aws-lambda';

// Mock internal utilities
jest.mock('../../src/internal', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
  isRetryable: jest.fn((err: unknown) => !(err as any).notRetryable),
  NotRetryableError: class NotRetryableError extends Error { notRetryable = true; },
}));

// Mock ErrorEventPublisher
jest.mock('../../src/engine/error-event-publisher', () => ({
  ErrorEventPublisher: jest.fn().mockImplementation(() => ({
    publishErrors: jest.fn().mockResolvedValue(undefined),
  })),
}));

function makeEvent(records: ReturnType<typeof fakeDdbStreamRecord>[]): DynamoDBStreamEvent {
  return { Records: records };
}

describe('StreamEngine', () => {
  it('calls processRecord for each unmarshalled record', async () => {
    const processRecord = jest.fn().mockResolvedValue(undefined);
    const engine = new StreamEngine({
      serviceName: 'test',
      processRecord,
    });
    await engine.process(makeEvent([
      fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'A#1', __typename: 'A', tenantId: 't1' }),
      fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'A#2', __typename: 'A', tenantId: 't1' }),
    ]));
    expect(processRecord).toHaveBeenCalledTimes(2);
  });

  it('applies filter — skips non-matching records', async () => {
    const processRecord = jest.fn().mockResolvedValue(undefined);
    const engine = new StreamEngine({
      serviceName: 'test',
      filter: (r) => r.__typename === 'Order',
      processRecord,
    });
    await engine.process(makeEvent([
      fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'O#1', __typename: 'Order', tenantId: 't1' }),
      fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'G#1', __typename: 'Guard', tenantId: 't1' }),
    ]));
    expect(processRecord).toHaveBeenCalledTimes(1);
  });

  it('groups records and calls processGroup', async () => {
    const processGroup = jest.fn().mockResolvedValue(undefined);
    const engine = new StreamEngine({
      serviceName: 'test',
      groupBy: { key: (r) => r.tenantId },
      processGroup,
    });
    await engine.process(makeEvent([
      fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'A#1', __typename: 'A', tenantId: 't1' }),
      fakeDdbStreamRecord('INSERT', { pk: 'T#t2', sk: 'A#2', __typename: 'A', tenantId: 't2' }),
      fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'A#3', __typename: 'A', tenantId: 't1' }),
    ]));
    expect(processGroup).toHaveBeenCalledTimes(2);
    const t1Call = processGroup.mock.calls.find((c: unknown[]) => c[0] === 't1');
    expect(t1Call[1]).toHaveLength(2);
  });

  it('applies groupBy pick:last', async () => {
    const processGroup = jest.fn().mockResolvedValue(undefined);
    const engine = new StreamEngine({
      serviceName: 'test',
      groupBy: { key: (r) => r.tenantId, pick: 'last' },
      processGroup,
    });
    await engine.process(makeEvent([
      fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'A#1', __typename: 'A', tenantId: 't1', v: 1 }),
      fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'A#2', __typename: 'A', tenantId: 't1', v: 2 }),
    ]));
    expect(processGroup).toHaveBeenCalledTimes(1);
    // pick:last wraps single record in array for processGroup
    expect(processGroup.mock.calls[0][1]).toHaveLength(1);
    expect(processGroup.mock.calls[0][1][0].v).toBe(2);
  });

  it('does not throw when all records process successfully', async () => {
    const engine = new StreamEngine({
      serviceName: 'test',
      processRecord: jest.fn().mockResolvedValue(undefined),
    });
    await expect(engine.process(makeEvent([
      fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'A#1', __typename: 'A', tenantId: 't1' }),
    ]))).resolves.toBeUndefined();
  });

  it('throws StreamBatchError when retryable error occurs', async () => {
    const engine = new StreamEngine({
      serviceName: 'test',
      processRecord: jest.fn().mockRejectedValue(new Error('timeout')),
    });
    await expect(engine.process(makeEvent([
      fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'A#1', __typename: 'A', tenantId: 't1' }),
    ]))).rejects.toThrow('StreamBatchError');
  });

  it('does NOT throw for non-retryable errors (publishes to bus)', async () => {
    const { NotRetryableError } = await import('../../src/internal');
    const engine = new StreamEngine({
      serviceName: 'test',
      busName: 'test-bus',
      processRecord: jest.fn().mockRejectedValue(new NotRetryableError('bad data')),
    });
    await expect(engine.process(makeEvent([
      fakeDdbStreamRecord('INSERT', { pk: 'T#t1', sk: 'A#1', __typename: 'A', tenantId: 't1' }),
    ]))).resolves.toBeUndefined();
  });

  it('skips records with no image (null from unmarshal)', async () => {
    const processRecord = jest.fn().mockResolvedValue(undefined);
    const engine = new StreamEngine({
      serviceName: 'test',
      processRecord,
    });
    const badRecord = fakeDdbStreamRecord('REMOVE', {
      pk: 'T#t1', sk: 'A#1', __typename: 'A', tenantId: 't1',
    });
    badRecord.dynamodb!.OldImage = undefined;

    await engine.process(makeEvent([badRecord]));
    expect(processRecord).not.toHaveBeenCalled();
  });
});
