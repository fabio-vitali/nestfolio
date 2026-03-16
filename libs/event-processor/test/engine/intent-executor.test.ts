import { IntentExecutor } from '../../src/engine/intent-executor';
import type { EventContext } from '../../src/types/event-context';
import type { RecordIntent, ProjectIntent, AccumulateIntent, SkipIntent } from '../../src/types/write-intent';

// Mock guardedWrite from internal
const mockGuardedWrite = jest.fn().mockResolvedValue(true);

jest.mock('../../src/internal', () => ({
  guardedWrite: (...args: unknown[]) => mockGuardedWrite(...args),
  NotRetryableError: class NotRetryableError extends Error {},
}));

const fakeCtx: EventContext = {
  eventId: 'evt-1',
  eventType: 'ORDER_FILLED',
  tenantId: 'tenant-1',
  timestamp: '2026-01-01T00:00:00Z',
  receiveCount: 1,
  serviceName: 'test-svc',
} as EventContext;

describe('IntentExecutor', () => {
  let mockDocClient: any;
  let executor: IntentExecutor;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDocClient = {
      send: jest.fn().mockResolvedValue({}),
    };
    mockGuardedWrite.mockResolvedValue(true);
    executor = new IntentExecutor({ docClient: mockDocClient, tableName: 'TestTable' });
  });

  describe('record intent (putIfNotExists)', () => {
    const intent: RecordIntent = { _tag: 'record', typename: 'LedgerEntry', fields: { amount: 100 } };

    it('sends PutCommand with condition expression', async () => {
      const result = await executor.execute(intent, fakeCtx);
      expect(result.success).toBe(true);
      expect(mockDocClient.send).toHaveBeenCalledTimes(1);

      const cmd = mockDocClient.send.mock.calls[0][0].input;
      expect(cmd.TableName).toBe('TestTable');
      expect(cmd.Item.pk).toBe('T#tenant-1');
      expect(cmd.Item.sk).toBe('LedgerEntry#evt-1');
      expect(cmd.Item.__typename).toBe('LedgerEntry');
      expect(cmd.Item.amount).toBe(100);
      expect(cmd.ConditionExpression).toBe('attribute_not_exists(pk)');
    });

    it('returns deduplicated when ConditionalCheckFailedException', async () => {
      const err = new Error('cond');
      err.name = 'ConditionalCheckFailedException';
      mockDocClient.send.mockRejectedValueOnce(err);

      const result = await executor.execute(intent, fakeCtx);
      expect(result.success).toBe(true);
      expect(result.deduplicated).toBe(true);
    });

    it('uses key overrides when provided', async () => {
      const overridden: RecordIntent = { ...intent, overrides: { pk: 'Custom#1', sk: 'Custom#2' } };
      await executor.execute(overridden, fakeCtx);

      const cmd = mockDocClient.send.mock.calls[0][0].input;
      expect(cmd.Item.pk).toBe('Custom#1');
      expect(cmd.Item.sk).toBe('Custom#2');
    });
  });

  describe('project intent (upsert)', () => {
    const intent: ProjectIntent = { _tag: 'project', typename: 'Summary', fields: { total: 42 } };

    it('sends PutCommand without condition (upsert)', async () => {
      const result = await executor.execute(intent, fakeCtx);
      expect(result.success).toBe(true);

      const cmd = mockDocClient.send.mock.calls[0][0].input;
      expect(cmd.Item.pk).toBe('T#tenant-1');
      expect(cmd.Item.sk).toBe('Summary');
      expect(cmd.Item.total).toBe(42);
      expect(cmd.ConditionExpression).toBeUndefined();
    });
  });

  describe('accumulate intent (guardedWrite)', () => {
    const intent: AccumulateIntent = { _tag: 'accumulate', typename: 'Stats', field: 'count', increment: 1 };

    it('delegates to guardedWrite from lambda-utils', async () => {
      const result = await executor.execute(intent, fakeCtx);
      expect(result.success).toBe(true);
      expect(result.deduplicated).toBeFalsy();

      expect(mockGuardedWrite).toHaveBeenCalledWith(
        mockDocClient,
        'TestTable',
        { pk: 'T#tenant-1', sk: 'ProcessedEvent#evt-1' },
        expect.arrayContaining([
          expect.objectContaining({
            Update: expect.objectContaining({
              Key: { pk: 'T#tenant-1', sk: 'Stats' },
            }),
          }),
        ]),
        undefined, // default ttl
      );
    });

    it('returns deduplicated when guardedWrite returns false', async () => {
      mockGuardedWrite.mockResolvedValueOnce(false);

      const result = await executor.execute(intent, fakeCtx);
      expect(result.success).toBe(true);
      expect(result.deduplicated).toBe(true);
    });

    it('passes ttl override to guardedWrite', async () => {
      const withTtl: AccumulateIntent = { ...intent, ttl: 604800 };
      await executor.execute(withTtl, fakeCtx);

      expect(mockGuardedWrite).toHaveBeenCalledWith(
        mockDocClient, 'TestTable',
        expect.any(Object), expect.any(Array),
        604800,
      );
    });
  });

  describe('skip intent', () => {
    it('does nothing', async () => {
      const result = await executor.execute({ _tag: 'skip' } as SkipIntent, fakeCtx);
      expect(result.success).toBe(true);
      expect(mockDocClient.send).not.toHaveBeenCalled();
      expect(mockGuardedWrite).not.toHaveBeenCalled();
    });
  });

  describe('s3-put intent', () => {
    it('returns failure result (requires S3 executor pipeline)', async () => {
      const result = await executor.execute({ _tag: 's3-put', body: {}, format: 'json' }, fakeCtx);
      expect(result).toEqual({ _tag: 's3-put', success: false });
      expect(mockDocClient.send).not.toHaveBeenCalled();
    });
  });
});
