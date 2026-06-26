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
    DeleteCommand: jest.fn().mockImplementation((input) => ({ _type: 'Delete', input })),
    BatchGetCommand: jest.fn().mockImplementation((input) => ({ _type: 'BatchGet', input })),
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
    protected async putIfNotExists(_item: Record<string, unknown>): Promise<boolean> {
      return true;
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
    protected async queryAll(input: unknown) {
      const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
      const result = await this.docClient.send(new QueryCommand(input));
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
  withMethodLogging: jest.fn((_className: string) =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),
}));

import { createStagedOrderProcessor, type StagedOrderProcessorDeps } from '../../src/handlers/staged-order-processor';
import { OrderRepository } from '../../src/repositories/order.repository';
import { SafetyChecksService } from '../../src/services/safety-checks.service';

describe('staged-order-processor', () => {
  const repository = new OrderRepository('test-table');
  const safetyChecks = new SafetyChecksService(repository);

  const deps: StagedOrderProcessorDeps = { repository, safetyChecks };
  const processStagedOrders = createStagedOrderProcessor(deps);

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({ Items: [] });
  });

  it('should submit staged orders that pass safety checks', async () => {
    // getAllStagedOrders: step 1 — GSI query returns keys
    mockSend.mockResolvedValueOnce({
      Items: [{ pk: 'StagedOrder#t1#o1', sk: 'StagedOrder', __typename: 'StagedOrder', timestamp: '2025-01-01T00:00:00.000Z' }],
    });
    // getAllStagedOrders: step 2 — BatchGet returns full items
    mockSend.mockResolvedValueOnce({
      Responses: {
        'test-table': [
          {
            pk: 'StagedOrder#t1#o1',
            sk: 'StagedOrder',
            __typename: 'StagedOrder',
            tenantId: 't1',
            orderId: 'o1',
            symbol: 'AAPL',
            side: 'BUY',
            quantityOrAmountCents: 10,
            timestamp: '2025-01-01T00:00:00.000Z',
          },
        ],
      },
    });

    jest.spyOn(safetyChecks, 'runAllChecks').mockResolvedValueOnce({
      passed: true,
      checks: { reconciliationLock: false, conflictingStagedOrders: false },
    });

    // updateOrderStatus (transactWrite) + deleteStagedOrder (delete)
    mockSend.mockResolvedValueOnce({}); // transactWrite for updateOrderStatus
    mockSend.mockResolvedValueOnce({}); // deleteStagedOrder

    const result = await processStagedOrders();

    expect(result.submitted).toBe(1);
    expect(result.rejected).toBe(0);
    expect(result.errors).toBe(0);
    expect(safetyChecks.runAllChecks).toHaveBeenCalledWith('t1', expect.any(Array));
  });

  it('should reject staged orders that fail safety checks', async () => {
    // getAllStagedOrders: step 1 — GSI query returns keys
    mockSend.mockResolvedValueOnce({
      Items: [{ pk: 'StagedOrder#t1#o2', sk: 'StagedOrder', __typename: 'StagedOrder', timestamp: '2025-01-01T00:00:00.000Z' }],
    });
    // getAllStagedOrders: step 2 — BatchGet returns full items
    mockSend.mockResolvedValueOnce({
      Responses: {
        'test-table': [
          {
            pk: 'StagedOrder#t1#o2',
            sk: 'StagedOrder',
            __typename: 'StagedOrder',
            tenantId: 't1',
            orderId: 'o2',
            symbol: 'VTI',
            side: 'BUY',
            quantityOrAmountCents: 5,
            timestamp: '2025-01-01T00:00:00.000Z',
          },
        ],
      },
    });

    jest.spyOn(safetyChecks, 'runAllChecks').mockResolvedValueOnce({
      passed: false,
      reason: 'Conflicting staged orders exist for the same instruments',
      checks: { reconciliationLock: false, conflictingStagedOrders: true },
    });

    // updateOrderStatus (transactWrite) + deleteStagedOrder (delete)
    mockSend.mockResolvedValueOnce({}); // transactWrite for updateOrderStatus
    mockSend.mockResolvedValueOnce({}); // deleteStagedOrder

    const result = await processStagedOrders();

    expect(result.submitted).toBe(0);
    expect(result.rejected).toBe(1);
    expect(result.errors).toBe(0);
  });

  it('should handle no staged orders gracefully', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const result = await processStagedOrders();

    expect(result.submitted).toBe(0);
    expect(result.rejected).toBe(0);
    expect(result.errors).toBe(0);
  });

  it('should process multiple staged orders from different tenants', async () => {
    // getAllStagedOrders: step 1 — GSI query returns keys
    mockSend.mockResolvedValueOnce({
      Items: [
        { pk: 'StagedOrder#t1#o1', sk: 'StagedOrder', __typename: 'StagedOrder', timestamp: '2025-01-01T00:00:00.000Z' },
        { pk: 'StagedOrder#t2#o2', sk: 'StagedOrder', __typename: 'StagedOrder', timestamp: '2025-01-01T00:00:00.000Z' },
      ],
    });
    // getAllStagedOrders: step 2 — BatchGet returns full items
    mockSend.mockResolvedValueOnce({
      Responses: {
        'test-table': [
          {
            pk: 'StagedOrder#t1#o1',
            sk: 'StagedOrder',
            __typename: 'StagedOrder',
            tenantId: 't1',
            orderId: 'o1',
            symbol: 'AAPL',
            side: 'BUY',
            quantityOrAmountCents: 10,
            timestamp: '2025-01-01T00:00:00.000Z',
          },
          {
            pk: 'StagedOrder#t2#o2',
            sk: 'StagedOrder',
            __typename: 'StagedOrder',
            tenantId: 't2',
            orderId: 'o2',
            symbol: 'VTI',
            side: 'SELL',
            quantityOrAmountCents: 5,
            timestamp: '2025-01-01T00:00:00.000Z',
          },
        ],
      },
    });

    jest.spyOn(safetyChecks, 'runAllChecks')
      .mockResolvedValueOnce({
        passed: true,
        checks: { reconciliationLock: false, conflictingStagedOrders: false },
      })
      .mockResolvedValueOnce({
        passed: false,
        reason: 'Reconciliation is in progress',
        checks: { reconciliationLock: true, conflictingStagedOrders: false },
      });

    // First order: updateOrderStatus + deleteStagedOrder
    mockSend.mockResolvedValueOnce({}); // transactWrite
    mockSend.mockResolvedValueOnce({}); // delete
    // Second order: updateOrderStatus + deleteStagedOrder
    mockSend.mockResolvedValueOnce({}); // transactWrite
    mockSend.mockResolvedValueOnce({}); // delete

    const result = await processStagedOrders();

    expect(result.submitted).toBe(1);
    expect(result.rejected).toBe(1);
    expect(result.errors).toBe(0);
  });

  it('should count errors and continue processing remaining orders', async () => {
    // getAllStagedOrders: step 1 — GSI query returns keys
    mockSend.mockResolvedValueOnce({
      Items: [
        { pk: 'StagedOrder#t1#o1', sk: 'StagedOrder', __typename: 'StagedOrder', timestamp: '2025-01-01T00:00:00.000Z' },
        { pk: 'StagedOrder#t2#o2', sk: 'StagedOrder', __typename: 'StagedOrder', timestamp: '2025-01-01T00:00:00.000Z' },
      ],
    });
    // getAllStagedOrders: step 2 — BatchGet returns full items
    mockSend.mockResolvedValueOnce({
      Responses: {
        'test-table': [
          {
            pk: 'StagedOrder#t1#o1',
            sk: 'StagedOrder',
            __typename: 'StagedOrder',
            tenantId: 't1',
            orderId: 'o1',
            symbol: 'AAPL',
            side: 'BUY',
            quantityOrAmountCents: 10,
            timestamp: '2025-01-01T00:00:00.000Z',
          },
          {
            pk: 'StagedOrder#t2#o2',
            sk: 'StagedOrder',
            __typename: 'StagedOrder',
            tenantId: 't2',
            orderId: 'o2',
            symbol: 'VTI',
            side: 'BUY',
            quantityOrAmountCents: 5,
            timestamp: '2025-01-01T00:00:00.000Z',
          },
        ],
      },
    });

    // First order: safety checks throw
    jest.spyOn(safetyChecks, 'runAllChecks')
      .mockRejectedValueOnce(new Error('DynamoDB timeout'))
      .mockResolvedValueOnce({
        passed: true,
        checks: { reconciliationLock: false, conflictingStagedOrders: false },
      });

    // Second order: updateOrderStatus + deleteStagedOrder
    mockSend.mockResolvedValueOnce({}); // transactWrite
    mockSend.mockResolvedValueOnce({}); // delete

    const result = await processStagedOrders();

    expect(result.submitted).toBe(1);
    expect(result.rejected).toBe(0);
    expect(result.errors).toBe(1);
  });
});
