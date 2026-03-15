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
    TransactWriteCommand: jest.fn().mockImplementation((input) => ({ _type: 'TransactWrite', input })),
  };
});

jest.mock('@nestfolio/platform-core', () => ({
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
    protected async putIfNotExists(item: Record<string, unknown>): Promise<boolean> {
      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      await this.docClient.send(new PutCommand({ TableName: this.tableName, Item: item }));
      return true;
    }
    protected async queryByPk(pk: string, skPrefix?: string) {
      const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
      const result = await this.docClient.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: skPrefix
          ? 'pk = :pk AND begins_with(sk, :sk)'
          : 'pk = :pk',
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
}));

jest.mock('@nestfolio/lambda-utils', () => ({
  withMethodLogging: jest.fn().mockImplementation(() =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),
}));

import { NotificationRepository } from '../src/repositories/notification.repository';

function extractUpdateAttrs(update: any): Record<string, unknown> {
  const names = update.ExpressionAttributeNames;
  const values = update.ExpressionAttributeValues;
  const result: Record<string, unknown> = {};
  for (const [nameKey, attrName] of Object.entries(names)) {
    const idx = nameKey.replace('#a', '');
    result[attrName as string] = values[`:v${idx}`];
  }
  return result;
}

describe('NotificationRepository', () => {
  let repo: NotificationRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new NotificationRepository('test-table');
  });

  describe('createNotification', () => {
    it('should create a Notification with status CREATED', async () => {
      mockSend.mockResolvedValueOnce({});

      const created = await repo.createNotification('t1', 'notif-1', {
        title: 'Welcome to Nestfolio',
        body: 'Your account setup is complete.',
        channel: 'email',
      });

      expect(created).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.Item).toMatchObject({
        pk: 'Notification#t1#notif-1',
        sk: 'Notification',
        __typename: 'Notification',
        tenantId: 't1',
        notificationId: 'notif-1',
        status: 'CREATED',
        title: 'Welcome to Nestfolio',
        body: 'Your account setup is complete.',
        channel: 'email',
      });
    });
  });

  describe('updateNotificationStatus', () => {
    it('should update status with edit event in transaction', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.updateNotificationStatus('t1', 'notif-1', 'SENT', {
        sentAt: '2025-01-01T00:00:00.000Z',
      });

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.TransactItems).toHaveLength(2);
      const updateItem = call.input.TransactItems[0].Update;
      expect(updateItem.Key).toEqual({ pk: 'Notification#t1#notif-1', sk: 'Notification' });
      const attrs = extractUpdateAttrs(updateItem);
      expect(attrs).toMatchObject({ status: 'SENT', sentAt: '2025-01-01T00:00:00.000Z' });
      expect(call.input.TransactItems[1].Put.Item).toMatchObject({
        __typename: 'EditEvent',
        operation: 'replace',
      });
    });

    it('should use Update (not Put) to preserve existing attributes', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.updateNotificationStatus('t1', 'notif-1', 'SENT');

      const call = mockSend.mock.calls[0][0];
      const firstItem = call.input.TransactItems[0];
      expect(firstItem.Update).toBeDefined();
      expect(firstItem.Put).toBeUndefined();
      const attrs = extractUpdateAttrs(firstItem.Update);
      expect(attrs).not.toHaveProperty('pk');
      expect(attrs).not.toHaveProperty('sk');
      expect(attrs).not.toHaveProperty('__typename');
      expect(attrs).not.toHaveProperty('notificationId');
    });
  });

  describe('createNotification — error paths', () => {
    it('should propagate DynamoDB errors on create', async () => {
      mockSend.mockRejectedValueOnce(new Error('ProvisionedThroughputExceededException'));

      await expect(
        repo.createNotification('t1', 'notif-err', {
          title: 'Test',
          body: 'Test body',
          channel: 'email',
        }),
      ).rejects.toThrow('ProvisionedThroughputExceededException');
    });

    it('should propagate TransactWriteItems error on status update', async () => {
      mockSend.mockRejectedValueOnce(new Error('TransactionCanceledException'));

      await expect(
        repo.updateNotificationStatus('t1', 'notif-err', 'SENT', {}),
      ).rejects.toThrow('TransactionCanceledException');
    });
  });

  describe('createMonthlyReport', () => {
    it('should create a MonthlyReport with correct pk and sk', async () => {
      mockSend.mockResolvedValueOnce({});

      const created = await repo.createMonthlyReport('t1', 'report-1', {
        period: '2025-01',
        status: 'GENERATED',
      });

      expect(created).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.Item).toMatchObject({
        pk: 'MonthlyReport#t1#report-1',
        sk: 'MonthlyReport',
        __typename: 'MonthlyReport',
        tenantId: 't1',
        reportId: 'report-1',
        period: '2025-01',
        status: 'GENERATED',
      });
    });
  });
});
