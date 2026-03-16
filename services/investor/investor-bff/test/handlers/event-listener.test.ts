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
    GetCommand: jest.fn().mockImplementation((input) => ({ _type: 'Get', input })),
    QueryCommand: jest.fn().mockImplementation((input) => ({ _type: 'Query', input })),
    UpdateCommand: jest.fn().mockImplementation((input) => ({ _type: 'Update', input })),
    TransactWriteCommand: jest.fn().mockImplementation((input) => ({ _type: 'TransactWrite', input })),
  };
});

jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
  TableRepository: class {
    protected readonly docClient: { send: jest.Mock };
    protected readonly tableName: string;
    constructor(tableName: string) {
      this.tableName = tableName;
      this.docClient = { send: mockSend };
    }
    protected async put(item: Record<string, unknown>) {
      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      await this.docClient.send(new PutCommand({ TableName: this.tableName, Item: item }));
    }
    protected async queryByPk(pk: string, skPrefix?: string) {
      const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
      const result = await this.docClient.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: skPrefix ? 'pk = :pk AND begins_with(sk, :sk)' : 'pk = :pk',
        ExpressionAttributeValues: { ':pk': pk, ...(skPrefix ? { ':sk': skPrefix } : {}) },
      }));
      return result.Items ?? [];
    }
    protected async transactWrite(input: unknown) {
      const { TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
      await this.docClient.send(new TransactWriteCommand(input));
    }
    protected buildTransactUpdate(pk: string, sk: string, attrs: Record<string, unknown>) {
      const entries = Object.entries(attrs);
      const names: Record<string, string> = {};
      const values: Record<string, unknown> = {};
      const sets: string[] = [];
      entries.forEach(([k, v], i) => { names[`#a${i}`] = k; values[`:v${i}`] = v; sets.push(`#a${i} = :v${i}`); });
      return { Update: { TableName: this.tableName, Key: { pk, sk }, UpdateExpression: `SET ${sets.join(', ')}`, ExpressionAttributeNames: names, ExpressionAttributeValues: values } };
    }
  },
  getUUID: jest.fn().mockReturnValue('test-uuid'),
  getTime: jest.fn().mockReturnValue('2025-01-01T00:00:00.000Z'),
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },

  requireEnv: (name: string) => process.env[name] ?? name,
  withMethodLogging: jest.fn().mockImplementation(() =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),

  EntityNotFoundError: class extends Error {
    constructor(public entityType: string, public entityId: string) {
      super(`${entityType} with id '${entityId}' not found`);
    }
  },

}));
import { createTestHarness, fakeSqsRecord } from '@nestfolio/event-processor';
import { createHandlers, type EventListenerDeps } from '../../src/handlers/event-listener';

describe('investor-bff event-listener', () => {
  const mockPipes = {
    userRegisteredPipe: { process: jest.fn().mockResolvedValue(undefined) },
    notificationCreatedPipe: { process: jest.fn().mockResolvedValue(undefined) },
    balanceUpdatedPipe: { process: jest.fn().mockResolvedValue(undefined) },
  };
  const deps: EventListenerDeps = mockPipes as any;
  const harness = createTestHarness({ serviceName: 'investor-bff', handlers: createHandlers(deps) });

  beforeEach(() => jest.clearAllMocks());

  it('routes USER_REGISTERED to userRegisteredPipe', async () => {
    const result = await harness.process([
      fakeSqsRecord('USER_REGISTERED', { email: 'a@b.com' }, { tenantId: 't1' }),
    ]);
    expect(mockPipes.userRegisteredPipe.process).toHaveBeenCalledWith(
      expect.objectContaining({ event: expect.objectContaining({ type: 'USER_REGISTERED' }) }),
    );
  });

  it('routes NOTIFICATION_CREATED to notificationCreatedPipe', async () => {
    await harness.process([
      fakeSqsRecord('NOTIFICATION_CREATED', { channel: 'email' }, { tenantId: 't1' }),
    ]);
    expect(mockPipes.notificationCreatedPipe.process).toHaveBeenCalled();
  });

  it('routes BALANCE_UPDATED to balanceUpdatedPipe', async () => {
    await harness.process([
      fakeSqsRecord('BALANCE_UPDATED', { amount: 1000 }, { tenantId: 't1' }),
    ]);
    expect(mockPipes.balanceUpdatedPipe.process).toHaveBeenCalled();
  });

  it('skips unknown event types', async () => {
    const result = await harness.process([
      fakeSqsRecord('UNKNOWN_TYPE', {}, { tenantId: 't1' }),
    ]);
    expect(result.skipped).toBe(1);
    expect(mockPipes.userRegisteredPipe.process).not.toHaveBeenCalled();
  });
});
