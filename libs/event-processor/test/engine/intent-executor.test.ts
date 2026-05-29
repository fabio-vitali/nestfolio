import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { IntentExecutor } from '../../src/engine/intent-executor';
import { update } from '../../src/intents/update';
import type { EventContext } from '../../src/types/event-context';
import type { RecordIntent, ProjectIntent, ProjectVersionedIntent, AccumulateIntent, SkipIntent, StoreIntent } from '../../src/types/write-intent';

// Mock guardedWrite from internal
const mockGuardedWrite = jest.fn().mockResolvedValue(true);

jest.mock('../../src/internal', () => ({
  guardedWrite: (...args: unknown[]) => mockGuardedWrite(...args),
  NotRetryableError: class NotRetryableError extends Error {},
  RetryablePreconditionError: class RetryablePreconditionError extends Error {
    constructor(public readonly condition: string, public readonly cause: unknown) {
      super(`update precondition not met (condition: ${condition}); SQS will redrive`);
      this.name = 'RetryablePreconditionError';
    }
  },
}));

const ddbMock = mockClient(DynamoDBDocumentClient);
const s3Mock = mockClient(S3Client);

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3Client = new S3Client({});

const fakeCtx: EventContext = {
  eventId: 'evt-1',
  eventType: 'ORDER_FILLED',
  tenantId: 'tenant-1',
  timestamp: '2026-01-01T00:00:00Z',
  receiveCount: 1,
  serviceName: 'test-svc',
} as EventContext;

describe('IntentExecutor', () => {
  let executor: IntentExecutor;

  beforeEach(() => {
    jest.clearAllMocks();
    ddbMock.reset();
    s3Mock.reset();
    ddbMock.on(PutCommand).resolves({});
    ddbMock.on(UpdateCommand).resolves({});
    s3Mock.on(PutObjectCommand).resolves({});
    mockGuardedWrite.mockResolvedValue(true);
    executor = new IntentExecutor({ docClient, tableName: 'TestTable' });
  });

  describe('record intent (putIfNotExists)', () => {
    const intent: RecordIntent = { _tag: 'record', typename: 'LedgerEntry', fields: { amount: 100 } };

    it('sends PutCommand with condition expression', async () => {
      const result = await executor.execute(intent, fakeCtx);
      expect(result.success).toBe(true);
      expect(ddbMock).toHaveReceivedCommandTimes(PutCommand, 1);

      const cmd = ddbMock.commandCalls(PutCommand)[0].args[0].input;
      expect(cmd.TableName).toBe('TestTable');
      expect(cmd.Item!.pk).toBe('T#tenant-1');
      expect(cmd.Item!.sk).toBe('LedgerEntry#evt-1');
      expect(cmd.Item!.__typename).toBe('LedgerEntry');
      expect(cmd.Item!.amount).toBe(100);
      expect(cmd.ConditionExpression).toBe('attribute_not_exists(pk)');
    });

    it('returns deduplicated when ConditionalCheckFailedException', async () => {
      const err = new Error('cond');
      err.name = 'ConditionalCheckFailedException';
      ddbMock.on(PutCommand).rejectsOnce(err);

      const result = await executor.execute(intent, fakeCtx);
      expect(result.success).toBe(true);
      expect(result.deduplicated).toBe(true);
    });

    it('uses key overrides when provided', async () => {
      const overridden: RecordIntent = { ...intent, overrides: { pk: 'Custom#1', sk: 'Custom#2' } };
      await executor.execute(overridden, fakeCtx);

      const cmd = ddbMock.commandCalls(PutCommand)[0].args[0].input;
      expect(cmd.Item!.pk).toBe('Custom#1');
      expect(cmd.Item!.sk).toBe('Custom#2');
    });
  });

  describe('project intent (upsert)', () => {
    const intent: ProjectIntent = { _tag: 'project', typename: 'Summary', fields: { total: 42 } };

    it('sends PutCommand without condition (upsert)', async () => {
      const result = await executor.execute(intent, fakeCtx);
      expect(result.success).toBe(true);

      const cmd = ddbMock.commandCalls(PutCommand)[0].args[0].input;
      expect(cmd.Item!.pk).toBe('T#tenant-1');
      expect(cmd.Item!.sk).toBe('Summary');
      expect(cmd.Item!.total).toBe(42);
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
        docClient,
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
        docClient, 'TestTable',
        expect.any(Object), expect.any(Array),
        604800,
      );
    });
  });

  describe('skip intent', () => {
    it('does nothing', async () => {
      const result = await executor.execute({ _tag: 'skip' } as SkipIntent, fakeCtx);
      expect(result.success).toBe(true);
      expect(ddbMock).not.toHaveReceivedCommand(PutCommand);
      expect(ddbMock).not.toHaveReceivedCommand(UpdateCommand);
      expect(mockGuardedWrite).not.toHaveBeenCalled();
    });
  });

  describe('store intent', () => {
    it('returns failure result when no s3Client configured', async () => {
      const result = await executor.execute({ _tag: 'store', body: {}, format: 'json' } as StoreIntent, fakeCtx);
      expect(result).toEqual({ _tag: 'store', success: false });
      expect(ddbMock).not.toHaveReceivedCommand(PutCommand);
    });

    it('writes to S3 when s3Client and bucket are provided', async () => {
      const executorWithS3 = new IntentExecutor({
        docClient,
        tableName: 'TestTable',
        s3Client,
        bucket: 'my-bucket',
      });

      const result = await executorWithS3.execute({ _tag: 'store', body: { data: 1 }, format: 'json' } as StoreIntent, fakeCtx);
      expect(result).toEqual({ _tag: 'store', success: true });
      expect(s3Mock).toHaveReceivedCommandTimes(PutObjectCommand, 1);
      const cmd = s3Mock.commandCalls(PutObjectCommand)[0].args[0].input;
      expect(cmd.Bucket).toBe('my-bucket');
      expect(cmd.Key).toBe('test-svc/ORDER_FILLED/evt-1.json');
      expect(cmd.ContentType).toBe('application/json');
    });

    it('uses custom key override when provided', async () => {
      const executorWithS3 = new IntentExecutor({
        docClient,
        tableName: 'TestTable',
        s3Client,
        bucket: 'my-bucket',
      });

      await executorWithS3.execute({ _tag: 'store', body: [{ a: 1 }], format: 'csv', key: 'exports/data.csv' } as StoreIntent, fakeCtx);
      const cmd = s3Mock.commandCalls(PutObjectCommand)[0].args[0].input;
      expect(cmd.Key).toBe('exports/data.csv');
      expect(cmd.ContentType).toBe('text/csv');
    });
  });

  describe('projectVersioned intent (versioned full-row upsert)', () => {
    const intent: ProjectVersionedIntent = {
      _tag: 'projectVersioned',
      typename: 'PortfolioSummary',
      fields: { totalValueCents: 100 },
      version: 7,
    };

    it('sends a full-row PutCommand guarded by the version condition', async () => {
      const result = await executor.execute(intent, fakeCtx);
      expect(result).toEqual({ _tag: 'projectVersioned', success: true });

      const cmd = ddbMock.commandCalls(PutCommand)[0].args[0].input;
      expect(cmd.Item!.pk).toBe('T#tenant-1');
      expect(cmd.Item!.sk).toBe('PortfolioSummary');
      expect(cmd.Item!.__typename).toBe('PortfolioSummary');
      expect(cmd.Item!.__version).toBe(7);
      expect(cmd.Item!.totalValueCents).toBe(100);
      expect(cmd.ConditionExpression).toBe('attribute_not_exists(pk) OR attribute_not_exists(#v) OR #v < :version');
      expect(cmd.ExpressionAttributeNames).toEqual({ '#v': '__version' });
      expect(cmd.ExpressionAttributeValues).toEqual({ ':version': 7 });
    });

    it('drops (deduplicated) a stale/duplicate version on ConditionalCheckFailedException', async () => {
      const err = new Error('stale');
      err.name = 'ConditionalCheckFailedException';
      ddbMock.on(PutCommand).rejectsOnce(err);

      const result = await executor.execute(intent, fakeCtx);
      expect(result).toEqual({ _tag: 'projectVersioned', success: true, deduplicated: true });
    });

    it('re-throws non-condition errors (no silent drop)', async () => {
      const err = new Error('throughput');
      err.name = 'ProvisionedThroughputExceededException';
      ddbMock.on(PutCommand).rejectsOnce(err);

      await expect(executor.execute(intent, fakeCtx)).rejects.toThrow('throughput');
    });

    it('honors key overrides', async () => {
      const overridden = { ...intent, overrides: { pk: 'P#1', sk: 'S#1' } };
      await executor.execute(overridden, fakeCtx);
      const cmd = ddbMock.commandCalls(PutCommand)[0].args[0].input;
      expect(cmd.Item!.pk).toBe('P#1');
      expect(cmd.Item!.sk).toBe('S#1');
    });

    it('reserved __version from intent.version overrides any __version in fields', async () => {
      const sneaky = { ...intent, fields: { totalValueCents: 100, __version: 999 } };
      await executor.execute(sneaky, fakeCtx);
      const cmd = ddbMock.commandCalls(PutCommand)[0].args[0].input;
      expect(cmd.Item!.__version).toBe(7);
    });
  });

  describe('update intent', () => {
    it('should build UpdateCommand with SET expression', async () => {
      const intent = update('DecisionPacket', { status: 'APPROVED', authorityLevel: 'L1' });
      const result = await executor.execute(intent, fakeCtx);
      expect(result).toEqual({ _tag: 'update', success: true });
      expect(ddbMock).toHaveReceivedCommandTimes(UpdateCommand, 1);

      const cmd = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
      expect(cmd.TableName).toBe('TestTable');
      expect(cmd.Key).toEqual({ pk: 'T#tenant-1', sk: 'DecisionPacket' });
      // Should have SET expression with updatedAt added automatically
      expect(cmd.UpdateExpression).toContain('SET');
      expect(cmd.ExpressionAttributeValues).toBeDefined();
    });

    it('should include REMOVE expression when removes specified', async () => {
      const intent = update('DecisionPacket', { status: 'BLOCKED' }, { removes: ['tempField'] });
      const result = await executor.execute(intent, fakeCtx);
      expect(result).toEqual({ _tag: 'update', success: true });

      const cmd = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
      expect(cmd.UpdateExpression).toContain('REMOVE');
    });

    it('should use key overrides when provided', async () => {
      const intent = update('DecisionPacket', { status: 'APPROVED' }, {
        overrides: { pk: 'custom-pk', sk: 'custom-sk' },
      });
      const result = await executor.execute(intent, fakeCtx);
      expect(result).toEqual({ _tag: 'update', success: true });

      const cmd = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
      expect(cmd.Key).toEqual({ pk: 'custom-pk', sk: 'custom-sk' });
    });

    it('should include condition expression when provided', async () => {
      const intent = update('DecisionPacket', { status: 'APPROVED' }, {
        condition: 'attribute_exists(pk)',
      });
      await executor.execute(intent, fakeCtx);

      const cmd = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
      expect(cmd.ConditionExpression).toBe('attribute_exists(pk)');
    });

    it('returns deduplicated when ConditionalCheckFailedException and condition set with default policy', async () => {
      const err = new Error('cond-fail');
      err.name = 'ConditionalCheckFailedException';
      ddbMock.on(UpdateCommand).rejectsOnce(err);

      const intent = update('DecisionPacket', { status: 'BLOCKED' }, {
        condition: 'attribute_exists(pk)',
      });
      const result = await executor.execute(intent, fakeCtx);
      expect(result).toEqual({ _tag: 'update', success: true, deduplicated: true });
    });

    it('wraps ConditionalCheckFailedException as RetryablePreconditionError when onConditionFail is retry', async () => {
      const err = new Error('cond-fail');
      err.name = 'ConditionalCheckFailedException';
      ddbMock.on(UpdateCommand).rejectsOnce(err);

      // Hand-build the intent so we don't depend on Task 2's updateOrRetry
      // factory inside this engine-level test.
      const intent = {
        _tag: 'update' as const,
        typename: 'DecisionReadModel',
        updates: { status: 'BLOCKED' },
        condition: 'attribute_exists(pk)',
        onConditionFail: 'retry' as const,
      };

      // The thrown error must NOT be the original SDK exception: that one
      // carries `$fault: 'client'` and isRetryable() classifies it as
      // terminal — SQS would never redrive. The wrapper has no $fault and
      // falls through to the default-retryable branch of isRetryable().
      await expect(executor.execute(intent, fakeCtx))
        .rejects.toMatchObject({
          name: 'RetryablePreconditionError',
          condition: 'attribute_exists(pk)',
          cause: err,
        });
    });

    it('rethrows non-ConditionalCheckFailedException regardless of onConditionFail', async () => {
      const err = new Error('throughput-exceeded');
      err.name = 'ProvisionedThroughputExceededException';
      ddbMock.on(UpdateCommand).rejectsOnce(err);

      const intent = {
        _tag: 'update' as const,
        typename: 'DecisionReadModel',
        updates: { status: 'BLOCKED' },
        condition: 'attribute_exists(pk)',
        onConditionFail: 'retry' as const,
      };

      await expect(executor.execute(intent, fakeCtx))
        .rejects.toThrow('throughput-exceeded');
    });
  });
});
