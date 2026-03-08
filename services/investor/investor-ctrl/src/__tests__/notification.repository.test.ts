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
  },
  getUUID: jest.fn().mockReturnValue('test-uuid'),
  getTime: jest.fn().mockReturnValue('2025-01-01T00:00:00.000Z'),
  log: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

import { NotificationRepository } from '../repositories/notification.repository';

describe('NotificationRepository', () => {
  let repo: NotificationRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new NotificationRepository('test-table');
  });

  describe('createNotification', () => {
    it('should create a Notification with status CREATED', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.createNotification('t1', 'notif-1', {
        title: 'Welcome to Nestfolio',
        body: 'Your account setup is complete.',
        channel: 'email',
      });

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
      expect(call.input.TransactItems[0].Put.Item).toMatchObject({
        pk: 'Notification#t1#notif-1',
        sk: 'Notification',
        __typename: 'Notification',
        status: 'SENT',
      });
      expect(call.input.TransactItems[1].Put.Item).toMatchObject({
        __typename: 'EditEvent',
        operation: 'replace',
      });
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

      await repo.createMonthlyReport('t1', 'report-1', {
        period: '2025-01',
        status: 'GENERATED',
      });

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
