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
    protected async putIfNotExists(item: Record<string, unknown>): Promise<boolean> {
      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      try {
        await this.docClient.send(new PutCommand({ TableName: this.tableName, Item: item, ConditionExpression: 'attribute_not_exists(pk)' }));
        return true;
      } catch (err: any) {
        if (err.name === 'ConditionalCheckFailedException') return false;
        throw err;
      }
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
  log: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  NotRetryableError: class NotRetryableError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'NotRetryableError';
    }
  },

  requireEnv: (name: string) => process.env[name] ?? name,
  NotRetryableError: class NotRetryableError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'NotRetryableError';
    }
  },
  withMethodLogging: jest.fn().mockReturnValue((_name: string, fn: (...args: unknown[]) => unknown) => fn),

  EntityNotFoundError: class extends Error {
    constructor(public entityType: string, public entityId: string) {
      super(`${entityType} with id '${entityId}' not found`);
    }
  },

}));
process.env.TABLE_NAME = 'test-table';

import { createTestHarness, fakeSqsRecord } from '@nestfolio/event-processor';
import { ComplianceRepository } from '../src/repositories/compliance.repository';
import { RuleEngine } from '../src/rules/rule-engine';
import { MandateValidator } from '../src/rules/mandate-validator';
import { GuardrailEvaluator } from '../src/rules/guardrail-evaluator';
import { SuitabilityChecker } from '../src/rules/suitability-checker';
import { AuthorityResolver } from '../src/rules/authority-resolver';
import { createHandlers, type EventListenerDeps } from '../src/handlers/event-listener';

describe('event-listener handler', () => {
  const repository = new ComplianceRepository('test-table');
  const ruleEngine = new RuleEngine(
    new MandateValidator(),
    new GuardrailEvaluator(),
    new SuitabilityChecker(),
    new AuthorityResolver(),
  );

  const mockDeps: EventListenerDeps = {
    repository,
    ruleEngine,
  };

  const harness = createTestHarness({
    serviceName: 'compliance-ctrl',
    handlers: createHandlers(mockDeps),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
  });

  describe('decision events', () => {
    it('should process DECISION_PACKET_CREATED and persist compliance check', async () => {
      // getMandateSnapshot -> found
      mockSend.mockResolvedValueOnce({
        Item: {
          mandateId: 'm-1',
          level: 'DISCRETIONARY',
          monthlyTurnoverCapPercent: 10,
          maxSingleTradePercent: 5,
          effectiveDate: '2024-01-01T00:00:00.000Z',
          revokedAt: null,
        },
      });
      // createComplianceCheck -> put
      mockSend.mockResolvedValueOnce({});
      // updateCheckResult -> update
      mockSend.mockResolvedValueOnce({ Attributes: { status: 'COMPLETED', result: 'APPROVED' } });
      // createAuditArtifact -> put
      mockSend.mockResolvedValueOnce({});

      const result = await harness.process([
        fakeSqsRecord('DECISION_PACKET_CREATED', {
          decisionId: 'dp-1',
          tenantId: 't-1',
          userId: 'u-1',
          proposedTrades: [
            {
              symbol: 'AAPL',
              assetClass: 'EQUITY',
              side: 'BUY',
              quantityOrAmountCents: 2_000_00,
              targetWeightPercent: 2,
              rationale: 'Good value',
            },
          ],
          portfolioValue: 100_000_00,
          riskScore: 7,
          currentPositions: [{ ticker: 'MSFT', weight: 10 }],
        }, { tenantId: 't-1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockSend).toHaveBeenCalledTimes(4);
    });

    it('should handle missing mandate by creating BLOCKED result', async () => {
      // getMandateSnapshot -> not found
      mockSend.mockResolvedValueOnce({ Item: undefined });
      // createComplianceCheck -> put
      mockSend.mockResolvedValueOnce({});
      // updateCheckResult -> update
      mockSend.mockResolvedValueOnce({ Attributes: { status: 'COMPLETED', result: 'BLOCKED' } });

      const result = await harness.process([
        fakeSqsRecord('DECISION_PACKET_CREATED', {
          decisionId: 'dp-2',
          tenantId: 't-1',
          userId: 'u-1',
          proposedTrades: [],
          portfolioValue: 0,
          riskScore: 5,
          currentPositions: [],
        }, { tenantId: 't-1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(0);
    });

    it('should report failure when DECISION_PACKET_CREATED is missing required fields', async () => {
      const result = await harness.process([
        fakeSqsRecord('DECISION_PACKET_CREATED', {
          decisionId: 'dp-missing',
          tenantId: 't-1',
          userId: 'u-1',
          // Missing: proposedTrades, portfolioValue, riskScore, currentPositions
        }, { tenantId: 't-1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(1);
      // Should NOT have called any DynamoDB operations (validation rejects before processing)
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should skip duplicate event when createComplianceCheck returns false', async () => {
      // getMandateSnapshot -> found
      mockSend.mockResolvedValueOnce({
        Item: {
          mandateId: 'm-1',
          level: 'DISCRETIONARY',
          monthlyTurnoverCapPercent: 10,
          maxSingleTradePercent: 5,
          effectiveDate: '2024-01-01T00:00:00.000Z',
          revokedAt: null,
        },
      });
      // createComplianceCheck -> putIfNotExists returns ConditionalCheckFailedException (duplicate)
      mockSend.mockRejectedValueOnce(Object.assign(new Error('ConditionalCheckFailedException'), { name: 'ConditionalCheckFailedException' }));

      const result = await harness.process([
        fakeSqsRecord('DECISION_PACKET_CREATED', {
          decisionId: 'dp-dup',
          tenantId: 't-1',
          userId: 'u-1',
          proposedTrades: [
            {
              symbol: 'AAPL',
              assetClass: 'EQUITY',
              side: 'BUY',
              quantityOrAmountCents: 2_000_00,
              targetWeightPercent: 2,
              rationale: 'Good value',
            },
          ],
          portfolioValue: 100_000_00,
          riskScore: 7,
          currentPositions: [{ ticker: 'MSFT', weight: 10 }],
        }, { tenantId: 't-1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(0);
      // Should have called: getMandateSnapshot + createComplianceCheck (putIfNotExists failed) — no further calls
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should skip unknown event types gracefully', async () => {
      const result = await harness.process([
        fakeSqsRecord('UNKNOWN_EVENT', {}, { tenantId: 't-1' }),
      ]);
      expect(result.skipped).toBe(1);
    });

    it('should report batch item failures for processing errors', async () => {
      // getMandateSnapshot throws
      mockSend.mockRejectedValueOnce(new Error('DDB error'));

      const result = await harness.process([
        fakeSqsRecord('DECISION_PACKET_CREATED', {
          decisionId: 'dp-fail',
          tenantId: 't-1',
          userId: 'u-1',
          proposedTrades: [],
          portfolioValue: 100_000_00,
          riskScore: 7,
          currentPositions: [],
        }, { tenantId: 't-1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(1);
    });

    it('should proceed when DECISION_PACKET_CREATED has all required fields', async () => {
      // getMandateSnapshot -> found
      mockSend.mockResolvedValueOnce({
        Item: {
          mandateId: 'm-1',
          level: 'DISCRETIONARY',
          monthlyTurnoverCapPercent: 10,
          maxSingleTradePercent: 5,
          effectiveDate: '2024-01-01T00:00:00.000Z',
          revokedAt: null,
        },
      });
      // createComplianceCheck -> put
      mockSend.mockResolvedValueOnce({});
      // updateCheckResult -> update
      mockSend.mockResolvedValueOnce({ Attributes: { status: 'COMPLETED', result: 'APPROVED' } });
      // createAuditArtifact -> put
      mockSend.mockResolvedValueOnce({});

      const result = await harness.process([
        fakeSqsRecord('DECISION_PACKET_CREATED', {
          decisionId: 'dp-valid',
          tenantId: 't-1',
          userId: 'u-1',
          proposedTrades: [
            {
              symbol: 'AAPL',
              assetClass: 'EQUITY',
              side: 'BUY',
              quantityOrAmountCents: 2_000_00,
              targetWeightPercent: 2,
              rationale: 'Good value',
            },
          ],
          portfolioValue: 100_000_00,
          riskScore: 7,
          currentPositions: [{ ticker: 'MSFT', weight: 10 }],
        }, { tenantId: 't-1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockSend).toHaveBeenCalledTimes(4);
    });
  });

  describe('mandate events', () => {
    it('should process MANDATE_GRANTED event and persist snapshot', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await harness.process([
        fakeSqsRecord('MANDATE_GRANTED', {
          tenantId: 't-1',
          userId: 'u-1',
          mandateId: 'm-1',
          level: 'DISCRETIONARY',
          monthlyTurnoverCapPercent: 10,
          maxSingleTradePercent: 5,
          effectiveDate: '2025-01-01T00:00:00.000Z',
        }, { tenantId: 't-1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should push retryable errors to failures', async () => {
      // Make the putMandateSnapshot fail
      mockSend.mockRejectedValueOnce(new Error('ServiceUnavailable'));

      const result = await harness.process([
        fakeSqsRecord('MANDATE_GRANTED', {
          tenantId: 't-1',
          userId: 'u-1',
          mandateId: 'm-1',
          level: 'DISCRETIONARY',
          monthlyTurnoverCapPercent: 10,
          maxSingleTradePercent: 5,
          effectiveDate: '2025-01-01T00:00:00.000Z',
        }, { tenantId: 't-1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(1);
    });

    it('should process MANDATE_REVOKED event', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await harness.process([
        fakeSqsRecord('MANDATE_REVOKED', {
          tenantId: 't-1',
          userId: 'u-1',
          mandateId: 'm-1',
          revokedAt: '2025-01-01T00:00:00.000Z',
        }, { tenantId: 't-1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should skip OPERATING_MODE_CHANGED gracefully (log only)', async () => {
      const result = await harness.process([
        fakeSqsRecord('OPERATING_MODE_CHANGED', {
          tenantId: 't-1', mode: 'AUTONOMOUS',
        }, { tenantId: 't-1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(0);
      // No DynamoDB calls for OPERATING_MODE_CHANGED
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should throw on MANDATE_GRANTED with missing required fields', async () => {
      const result = await harness.process([
        fakeSqsRecord('MANDATE_GRANTED', {
          tenantId: 't-1',
          userId: 'u-1',
          // mandateId and level are missing
        }, { tenantId: 't-1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(1);
    });
  });
});
