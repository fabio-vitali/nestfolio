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
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

jest.mock('@nestfolio/lambda-utils', () => ({
  withMethodLogging: jest.fn().mockImplementation(() =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),
}));

jest.mock('@nestfolio/domain-core', () => ({}));

import { NotificationRepository } from '../repositories/notification.repository';
import { NotificationLifecycleService } from '../services/notification-lifecycle.service';

describe('NotificationLifecycleService', () => {
  let service: NotificationLifecycleService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
    const repository = new NotificationRepository('test-table');
    service = new NotificationLifecycleService(repository);
  });

  describe('executeNotificationLifecycle', () => {
    it('should create welcome notification for ONBOARDING_COMPLETED', async () => {
      const context = {
        tenantId: 't1',
        triggerEvent: {
          id: 'evt-1',
          type: 'ONBOARDING_COMPLETED',
          timestamp: '2025-01-01T00:00:00.000Z',
          subject: { tenantId: 't1', userId: 'u1' },
          context: { tenantId: 't1' },
        },
      };

      const result = await service.executeNotificationLifecycle(context);

      expect(result.status).toBe('COMPLETED');
      expect(result.notificationId).toBe('test-uuid');

      // 1 createNotification + 2 updateNotificationStatus (SENT, DELIVERED) = 3
      expect(mockSend).toHaveBeenCalledTimes(3);

      // Verify the first call is createNotification with welcome message
      const createCall = mockSend.mock.calls[0][0];
      expect(createCall.input.Item).toMatchObject({
        __typename: 'Notification',
        title: 'Welcome to Nestfolio',
        body: 'Your account setup is complete. You can now start investing.',
        channel: 'email',
        status: 'CREATED',
      });
    });

    it('should create notification AND monthly report for ORDER_FILLED', async () => {
      const context = {
        tenantId: 't1',
        triggerEvent: {
          id: 'evt-2',
          type: 'ORDER_FILLED',
          timestamp: '2025-01-01T00:00:00.000Z',
          subject: { tenantId: 't1', orderId: 'ord-1', symbol: 'VTI', quantity: 10 },
          context: { tenantId: 't1' },
        },
      };

      const result = await service.executeNotificationLifecycle(context);

      expect(result.status).toBe('COMPLETED');

      // 1 createNotification + 2 updateNotificationStatus + 1 createMonthlyReport = 4
      expect(mockSend).toHaveBeenCalledTimes(4);

      // Verify the first call is createNotification
      const createCall = mockSend.mock.calls[0][0];
      expect(createCall.input.Item).toMatchObject({
        __typename: 'Notification',
        title: 'Order Executed',
        channel: 'email',
        status: 'CREATED',
      });

      // Verify the last call is createMonthlyReport
      const reportCall = mockSend.mock.calls[3][0];
      expect(reportCall.input.Item).toMatchObject({
        __typename: 'MonthlyReport',
        status: 'GENERATED',
      });
    });

    it('should return correct notification content for each event type', async () => {
      const eventTypes = [
        { type: 'ONBOARDING_COMPLETED', expectedTitle: 'Welcome to Nestfolio' },
        { type: 'MANDATE_GRANTED', expectedTitle: 'Investment Mandate Activated' },
        { type: 'GOAL_UPDATED', expectedTitle: 'Goal Updated' },
        { type: 'DEPOSIT_INITIATED', expectedTitle: 'Deposit Received' },
        { type: 'OPERATING_MODE_CHANGED', expectedTitle: 'Operating Mode Changed' },
        { type: 'DECISION_APPROVED', expectedTitle: 'Investment Decision Approved' },
        { type: 'ORDER_FILLED', expectedTitle: 'Order Executed' },
      ];

      for (const { type, expectedTitle } of eventTypes) {
        jest.clearAllMocks();
        mockSend.mockResolvedValue({});

        const context = {
          tenantId: 't1',
          triggerEvent: {
            id: `evt-${type}`,
            type,
            timestamp: '2025-01-01T00:00:00.000Z',
            subject: { tenantId: 't1' },
            context: { tenantId: 't1' },
          },
        };

        await service.executeNotificationLifecycle(context);

        const createCall = mockSend.mock.calls[0][0];
        expect(createCall.input.Item.title).toBe(expectedTitle);
      }
    });
  });
});
