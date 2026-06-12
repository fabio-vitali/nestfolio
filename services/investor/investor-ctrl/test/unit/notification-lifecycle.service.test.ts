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

import { ZodError } from 'zod';

jest.mock('@nestfolio/event-processor', () => ({
  // Pass parseSubject through from the real module — it's a pure function with no side effects.
  parseSubject: jest.requireActual('@nestfolio/event-processor').parseSubject,
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

  withMethodLogging: jest.fn().mockImplementation(() =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),

}));
import { NotificationRepository } from '../../src/repositories/notification.repository';
import { NotificationLifecycleService } from '../../src/services/notification-lifecycle.service';
import { NotificationDeliveryService } from '../../src/services/notification-delivery.service';

const testCtx = { tenantId: 't1', userId: 'u1', region: 'us-east-1' } as any;

describe('NotificationLifecycleService', () => {
  let service: NotificationLifecycleService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
    const repository = new NotificationRepository('test-table');
    const delivery = new NotificationDeliveryService();
    service = new NotificationLifecycleService(repository, delivery);
  });

  describe('executeNotificationLifecycle', () => {
    it('should create welcome notification for ONBOARDING_COMPLETED', async () => {
      const context = {
        requestContext: testCtx,
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
      expect(result.notificationId).toBe('evt-1');

      // 1 createNotification + 1 updateNotificationStatus (DELIVERED via delivery service) = 2
      expect(mockSend).toHaveBeenCalledTimes(2);

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
        requestContext: testCtx,
        triggerEvent: {
          id: 'evt-2',
          type: 'ORDER_FILLED',
          timestamp: '2025-01-01T00:00:00.000Z',
          // Fixture matches NormalizedOrderEventSchema: orderId, executionMode, timestamp required
          subject: { orderId: 'ord-1', executionMode: 'simulation', timestamp: '2025-01-01T00:00:00.000Z' },
          context: { tenantId: 't1' },
        },
      };

      const result = await service.executeNotificationLifecycle(context);

      expect(result.status).toBe('COMPLETED');

      // 1 createNotification + 1 updateNotificationStatus (DELIVERED) + 1 createMonthlyReport = 3
      expect(mockSend).toHaveBeenCalledTimes(3);

      // Verify the first call is createNotification
      const createCall = mockSend.mock.calls[0][0];
      expect(createCall.input.Item).toMatchObject({
        __typename: 'Notification',
        title: 'Order Executed',
        channel: 'email',
        status: 'CREATED',
      });

      // Verify the last call is createMonthlyReport
      const reportCall = mockSend.mock.calls[2][0];
      expect(reportCall.input.Item).toMatchObject({
        __typename: 'MonthlyReport',
        status: 'GENERATED',
      });
    });

    it('ORDER_FILLED with invalid subject throws ZodError (NormalizedOrderEventSchema contract enforcement)', async () => {
      // Empty subject violates NormalizedOrderEventSchema (orderId + executionMode required)
      const context = {
        requestContext: testCtx,
        triggerEvent: {
          id: 'evt-zod',
          type: 'ORDER_FILLED',
          timestamp: '2025-01-01T00:00:00.000Z',
          subject: {},
          context: { tenantId: 't1' },
        },
      };
      await expect(service.executeNotificationLifecycle(context)).rejects.toBeInstanceOf(ZodError);
    });

    it('should return correct notification content for each event type', async () => {
      // Subjects must conform to their producer schema where parseSubject is called.
      // ORDER_FILLED requires NormalizedOrderEventSchema; others don't read subject fields.
      const orderFilledSubject = { orderId: 'ord-t', executionMode: 'simulation', timestamp: '2025-01-01T00:00:00.000Z' };
      const eventTypes = [
        { type: 'ONBOARDING_COMPLETED', subject: {}, expectedTitle: 'Welcome to Nestfolio' },
        { type: 'MANDATE_ISSUED', subject: {}, expectedTitle: 'Investment Mandate Activated' },
        { type: 'MANDATE_REVOKED', subject: {}, expectedTitle: 'Mandate Revoked' },
        { type: 'GOAL_UPDATED', subject: {}, expectedTitle: 'Goal Updated' },
        { type: 'DEPOSIT_INITIATED', subject: {}, expectedTitle: 'Deposit Received' },
        { type: 'OPERATING_MODE_CHANGED', subject: {}, expectedTitle: 'Operating Mode Changed' },
        { type: 'DECISION_APPROVED', subject: {}, expectedTitle: 'Investment Decision Approved' },
        { type: 'ORDER_FILLED', subject: orderFilledSubject, expectedTitle: 'Order Executed' },
      ];

      for (const { type, subject, expectedTitle } of eventTypes) {
        jest.clearAllMocks();
        mockSend.mockResolvedValue({});

        const context = {
          requestContext: testCtx,
          triggerEvent: {
            id: `evt-${type}`,
            type,
            timestamp: '2025-01-01T00:00:00.000Z',
            subject,
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
