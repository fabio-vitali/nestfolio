const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/lib-dynamodb');
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: jest.fn().mockImplementation(() => ({ send: mockSend })),
    },
    PutCommand: jest.fn().mockImplementation((input) => ({ _type: 'Put', input })),
    QueryCommand: jest.fn().mockImplementation((input) => ({ _type: 'Query', input })),
    UpdateCommand: jest.fn().mockImplementation((input) => ({ _type: 'Update', input })),
    TransactWriteCommand: jest.fn().mockImplementation((input) => ({ _type: 'TransactWrite', input })),
  };
});

jest.mock('@nestfolio/event-processor', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ddb = jest.requireMock('@aws-sdk/lib-dynamodb') as {
    PutCommand: jest.Mock; QueryCommand: jest.Mock; TransactWriteCommand: jest.Mock;
  };
  return {
  TableRepository: class {
    protected readonly docClient: { send: jest.Mock };
    protected readonly tableName: string;
    constructor(tableName: string) {
      this.tableName = tableName;
      this.docClient = { send: mockSend };
    }
    protected async put(item: Record<string, unknown>) {
      await this.docClient.send(new ddb.PutCommand({ TableName: this.tableName, Item: item }));
    }
    protected async queryByPk(pk: string, skPrefix?: string) {
      const result = await this.docClient.send(new ddb.QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: skPrefix ? 'pk = :pk AND begins_with(sk, :sk)' : 'pk = :pk',
        ExpressionAttributeValues: { ':pk': pk, ...(skPrefix ? { ':sk': skPrefix } : {}) },
      }));
      return result.Items ?? [];
    }
    protected async queryAll(input: unknown) {
      const result = await this.docClient.send(new ddb.QueryCommand(input));
      return result.Items ?? [];
    }
    protected async transactWrite(input: unknown) {
      await this.docClient.send(new ddb.TransactWriteCommand(input));
    }
    protected async putIfNotExists(item: Record<string, unknown>): Promise<boolean> {
      try {
        await this.docClient.send(new ddb.PutCommand({ TableName: this.tableName, Item: item, ConditionExpression: 'attribute_not_exists(pk)' }));
        return true;
      } catch (error: unknown) {
        if ((error as { name?: string }).name === 'ConditionalCheckFailedException') return false;
        throw error;
      }
    }
  },
  getUUID: jest.fn().mockReturnValue('test-uuid'),
  getTime: jest.fn().mockReturnValue('2025-01-01T00:00:00.000Z'),
  asTenantId: (v: string) => v,
  asUserId: (v: string) => v,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },

  withMethodLogging: jest.fn((_className: string) =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),

  };
});
import { type RequestContext, asTenantId, asUserId } from '@nestfolio/event-processor';
import { LedgerRepository } from '../../src/repositories/ledger.repository';

describe('LedgerRepository', () => {
  let repo: LedgerRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({ Items: [], Attributes: { lastSequence: 1 } });
    repo = new LedgerRepository('test-table');
  });

  const testCtx: RequestContext = { tenantId: asTenantId('t1'), userId: asUserId('u1'), region: 'us-east-1' };

  it('putLedgerEntry writes correct pk/sk format', async () => {
    const created = await repo.putLedgerEntry({
      streamType: 'actual',
      eventId: 'e1',
      eventType: 'DEPOSIT_DETECTED',
      payload: { amountCents: 50000 },
      timestamp: '2025-01-01T00:00:00.000Z',
      sequenceNo: 1,
    }, testCtx);

    expect(created).toBe(true);
    const putCalls = mockSend.mock.calls.filter((c) => c[0]?._type === 'Put');
    expect(putCalls).toHaveLength(1);
    const item = putCalls[0][0].input.Item;
    expect(item.pk).toBe('Account#t1#actual');
    expect(item.sk).toBe('Event#e1');
    expect(item.__typename).toBe('LedgerEntry');
    expect(item.sourceEventId).toBe('e1');
    expect(item.sequenceNo).toBe(1);
  });

  it('putLedgerEntry returns false for duplicate entry', async () => {
    mockSend.mockRejectedValueOnce(
      Object.assign(new Error('Conditional'), { name: 'ConditionalCheckFailedException' }),
    );

    const created = await repo.putLedgerEntry({
      streamType: 'actual',
      eventId: 'e1',
      eventType: 'DEPOSIT_DETECTED',
      payload: { amountCents: 50000 },
      timestamp: '2025-01-01T00:00:00.000Z',
      sequenceNo: 1,
    }, testCtx);

    expect(created).toBe(false);
  });

  it('nextSequence atomically increments', async () => {
    mockSend.mockResolvedValueOnce({ Attributes: { lastSequence: 5 } });

    const seq = await repo.nextSequence('t1', 'actual');
    expect(seq).toBe(5);

    const updateCalls = mockSend.mock.calls.filter((c) => c[0]?._type === 'Update');
    expect(updateCalls).toHaveLength(1);
    const updateInput = updateCalls[0][0].input;
    expect(updateInput.Key.pk).toBe('Sequence#t1#actual');
    expect(updateInput.Key.sk).toBe('Counter');
  });

  it('getLatestSnapshot returns null when none exists', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const snapshot = await repo.getLatestSnapshot('t1', 'actual');
    expect(snapshot).toBeNull();
  });

  it('getLatestSnapshot returns snapshot when exists', async () => {
    const snapshotData = {
      pk: 'Account#t1#actual',
      sk: 'Snapshot#latest',
      cashBalanceCents: 10_000_000,
      positions: {},
    };
    mockSend.mockResolvedValueOnce({ Items: [snapshotData] });

    const snapshot = await repo.getLatestSnapshot('t1', 'actual');
    expect(snapshot).toEqual(snapshotData);
  });

  it('saveCheckpoint uses conditional write', async () => {
    mockSend.mockResolvedValueOnce({});

    await repo.saveCheckpoint('actual', '2025-01-01', {
      positions: {},
      cashBalanceCents: 10_000_000,
      lastEventSequence: 5,
    }, testCtx);

    const putCalls = mockSend.mock.calls.filter((c) => c[0]?._type === 'Put');
    expect(putCalls).toHaveLength(1);
    const putInput = putCalls[0][0].input;
    expect(putInput.ConditionExpression).toBe('attribute_not_exists(pk)');
    expect(putInput.Item.pk).toBe('Account#t1#actual');
    expect(putInput.Item.sk).toBe('Checkpoint#2025-01-01');
  });
});
