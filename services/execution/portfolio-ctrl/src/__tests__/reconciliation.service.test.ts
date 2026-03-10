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
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

jest.mock('@nestfolio/lambda-utils', () => ({
  withMethodLogging: jest.fn((_className: string) =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),
}));

jest.mock('@nestfolio/domain-core', () => ({}));

import { ReconciliationRepository } from '../repositories/reconciliation.repository';
import { ReconciliationService } from '../services/reconciliation.service';

describe('ReconciliationService', () => {
  let service: ReconciliationService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
    const repository = new ReconciliationRepository('test-table');
    service = new ReconciliationService(repository);
  });

  describe('reconcile', () => {
    it('should return COMPLETED when no drift detected', async () => {
      const result = await service.reconcile({
        tenantId: 't1',
        portfolioId: 'p1',
        intentPositions: [
          { instrument: 'AAPL', quantity: 100 },
          { instrument: 'MSFT', quantity: 50 },
        ],
        settlementPositions: [
          { instrument: 'AAPL', quantity: 100 },
          { instrument: 'MSFT', quantity: 50 },
        ],
      });

      expect(result.reconciliationId).toBe('test-uuid');
      expect(result.status).toBe('COMPLETED');
      expect(result.driftRecords).toHaveLength(0);
    });

    it('should return DRIFT_DETECTED when drift exists', async () => {
      const result = await service.reconcile({
        tenantId: 't1',
        portfolioId: 'p1',
        intentPositions: [
          { instrument: 'AAPL', quantity: 100 },
          { instrument: 'MSFT', quantity: 50 },
        ],
        settlementPositions: [
          { instrument: 'AAPL', quantity: 95 },
          { instrument: 'MSFT', quantity: 50 },
        ],
      });

      expect(result.status).toBe('DRIFT_DETECTED');
      expect(result.driftRecords).toHaveLength(1);
      expect(result.driftRecords[0]).toMatchObject({
        instrument: 'AAPL',
        intentQty: 100,
        settlementQty: 95,
        drift: 5,
      });
    });

    it('should handle multiple instruments with drift', async () => {
      const result = await service.reconcile({
        tenantId: 't1',
        portfolioId: 'p1',
        intentPositions: [
          { instrument: 'AAPL', quantity: 100 },
          { instrument: 'MSFT', quantity: 50 },
          { instrument: 'GOOG', quantity: 25 },
        ],
        settlementPositions: [
          { instrument: 'AAPL', quantity: 95 },
          { instrument: 'MSFT', quantity: 50 },
          { instrument: 'GOOG', quantity: 30 },
        ],
      });

      expect(result.status).toBe('DRIFT_DETECTED');
      expect(result.driftRecords).toHaveLength(2);

      const aaplDrift = result.driftRecords.find((d) => d.instrument === 'AAPL');
      expect(aaplDrift).toMatchObject({ drift: 5 });

      const googDrift = result.driftRecords.find((d) => d.instrument === 'GOOG');
      expect(googDrift).toMatchObject({ drift: -5 });
    });

    it('should handle instruments present only in intent', async () => {
      const result = await service.reconcile({
        tenantId: 't1',
        portfolioId: 'p1',
        intentPositions: [
          { instrument: 'AAPL', quantity: 100 },
          { instrument: 'TSLA', quantity: 20 },
        ],
        settlementPositions: [
          { instrument: 'AAPL', quantity: 100 },
        ],
      });

      expect(result.status).toBe('DRIFT_DETECTED');
      expect(result.driftRecords).toHaveLength(1);
      expect(result.driftRecords[0]).toMatchObject({
        instrument: 'TSLA',
        intentQty: 20,
        settlementQty: 0,
        drift: 20,
      });
    });

    it('should create reconciliation record and update status', async () => {
      await service.reconcile({
        tenantId: 't1',
        portfolioId: 'p1',
        intentPositions: [{ instrument: 'AAPL', quantity: 100 }],
        settlementPositions: [{ instrument: 'AAPL', quantity: 100 }],
      });

      // createReconciliation (put) + updateReconciliationStatus (transactWrite)
      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });
});
