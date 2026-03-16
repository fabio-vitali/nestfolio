const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  PutItemCommand: jest.fn().mockImplementation((input) => ({ _type: 'PutItem', input })),
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

  requireEnv: (name: string) => process.env[name] ?? name,
  withMethodLogging: jest.fn().mockImplementation(() =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),

}));
import { createTestHarness, fakeSqsRecord } from '@nestfolio/event-processor';
import { createHandlers, type EventListenerDeps } from '../src/handlers/event-listener';
import { NotificationRepository } from '../src/repositories/notification.repository';
import { NotificationLifecycleService } from '../src/services/notification-lifecycle.service';
import { NotificationDeliveryService } from '../src/services/notification-delivery.service';

describe('investor-ctrl event-listener', () => {
  const repository = new NotificationRepository('test-table');
  const delivery = new NotificationDeliveryService();
  const lifecycleService = new NotificationLifecycleService(repository, delivery);
  const executeSpy = jest.spyOn(lifecycleService, 'executeNotificationLifecycle').mockResolvedValue(undefined as any);

  const mockDeps: EventListenerDeps = { lifecycleService };

  const harness = createTestHarness({
    serviceName: 'investor-ctrl',
    handlers: createHandlers(mockDeps),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
    executeSpy.mockResolvedValue(undefined as any);
  });

  it('routes ONBOARDING_COMPLETED to lifecycle service', async () => {
    const result = await harness.process([
      fakeSqsRecord('ONBOARDING_COMPLETED', { userId: 'u1' }, { tenantId: 't1' }),
    ]);
    expect(result.skipped).toBe(0);
    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1' }),
    );
  });

  it('routes ORDER_FILLED to lifecycle service', async () => {
    await harness.process([
      fakeSqsRecord('ORDER_FILLED', { orderId: 'o1' }, { tenantId: 't1' }),
    ]);
    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1' }),
    );
  });

  it('handles all 8 event types', async () => {
    const types = [
      'ONBOARDING_COMPLETED', 'MANDATE_GRANTED', 'GOAL_UPDATED', 'DEPOSIT_INITIATED',
      'OPERATING_MODE_CHANGED', 'DECISION_APPROVED', 'ORDER_FILLED', 'BALANCE_UPDATED',
    ];
    for (const type of types) {
      jest.clearAllMocks();
      executeSpy.mockResolvedValue(undefined as any);
      await harness.process([fakeSqsRecord(type, {}, { tenantId: 't1' })]);
      expect(executeSpy).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 't1' }),
      );
    }
  });

  it('skips unknown event types', async () => {
    const result = await harness.process([
      fakeSqsRecord('UNKNOWN_EVENT', {}, { tenantId: 't1' }),
    ]);
    expect(result.skipped).toBe(1);
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it('reports failure when lifecycle service throws', async () => {
    executeSpy.mockRejectedValueOnce(new Error('Lifecycle failed'));
    const result = await harness.process([
      fakeSqsRecord('ONBOARDING_COMPLETED', { userId: 'u1' }, { tenantId: 't1' }),
    ]);
    expect(result.errors).toHaveLength(1);
    expect(result.batchItemFailures).toHaveLength(1);
  });

  it('processes multiple records in a batch', async () => {
    const result = await harness.process([
      fakeSqsRecord('ONBOARDING_COMPLETED', { userId: 'u1' }, { tenantId: 't1' }),
      fakeSqsRecord('MANDATE_GRANTED', { userId: 'u2' }, { tenantId: 't2' }),
      fakeSqsRecord('ORDER_FILLED', { orderId: 'o1' }, { tenantId: 't3' }),
    ]);
    expect(result.metrics.EventProcessed).toBe(3);
    expect(executeSpy).toHaveBeenCalledTimes(3);
  });
});
