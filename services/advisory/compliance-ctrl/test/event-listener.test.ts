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
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'ConditionalCheckFailedException') return false;
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
  withMethodLogging: jest.fn().mockReturnValue((_name: string, fn: (...args: unknown[]) => unknown) => fn),
  EntityNotFoundError: class extends Error {
    constructor(public entityType: string, public entityId: string) {
      super(`${entityType} with id '${entityId}' not found`);
    }
  },
}));
process.env.TABLE_NAME = 'test-table';

import { createTestHarness, fakeSqsRecord } from '@nestfolio/event-processor';
import { RuleEngine } from '../src/rules/rule-engine';
import { MandateValidator } from '../src/rules/mandate-validator';
import { GuardrailEvaluator } from '../src/rules/guardrail-evaluator';
import { SuitabilityChecker } from '../src/rules/suitability-checker';
import { AuthorityResolver } from '../src/rules/authority-resolver';
import { createHandlers, type EventListenerDeps } from '../src/handlers/event-listener';

const mandate = {
  mandateId: 'm-1',
  level: 'DISCRETIONARY',
  monthlyTurnoverCapPercent: 10,
  maxSingleTradePercent: 5,
  equityRiskBandPercent: 6,
  driftTriggerPercent: 4,
  singleEtfConcentrationPercent: 30,
  drawdownCircuitBreakerPercent: 12,
  effectiveDate: '2024-01-01T00:00:00.000Z',
  revokedAt: null,
};

describe('event-listener handler', () => {
  let getMandateSnapshot: jest.Mock;
  let evaluateSpy: jest.SpyInstance;
  let mockDeps: EventListenerDeps;

  const ruleEngine = new RuleEngine(
    new MandateValidator(),
    new GuardrailEvaluator(),
    new SuitabilityChecker(),
    new AuthorityResolver(),
  );

  beforeEach(() => {
    jest.clearAllMocks();
    getMandateSnapshot = jest.fn();
    evaluateSpy = jest.spyOn(ruleEngine, 'evaluate');
    mockDeps = {
      repository: { getMandateSnapshot },
      ruleEngine,
    };
  });

  const makeHarness = () =>
    createTestHarness({
      serviceName: 'compliance-ctrl',
      handlers: createHandlers(mockDeps),
    });

  const decisionPayload = {
    decisionId: 'dp-1',
    tenantId: 't-1',
    userId: 'u-1',
    proposedTrades: [
      {
        symbol: 'AAPL',
        assetClass: 'EQUITY',
        side: 'BUY',
        quantityOrAmountCents: 200_000,
        targetWeightPercent: 2,
        rationale: 'Good value',
      },
    ],
    portfolioValue: 10_000_000,
    riskScore: 7,
    currentPositions: [{ ticker: 'MSFT', weight: 10 }],
  };

  describe('decision events', () => {
    it('should return [record(ComplianceCheck), record(AuditArtifact)] when mandate is found and result is APPROVED', async () => {
      getMandateSnapshot.mockResolvedValue(mandate);
      evaluateSpy.mockReturnValue({
        result: 'APPROVED',
        violations: [],
        authorityLevel: 'L1',
      });

      const harness = makeHarness();
      const result = await harness.process([
        fakeSqsRecord('DECISION_PACKET_CREATED', decisionPayload, { tenantId: 't-1' }),
      ]);

      expect(result.batchItemFailures).toHaveLength(0);
      expect(result.intents).toHaveLength(2);
      expect(result.intents[0]).toMatchObject({
        _tag: 'record',
        typename: 'ComplianceCheck',
        fields: expect.objectContaining({
          result: 'APPROVED',
          status: 'COMPLETED',
          violations: [],
          authorityLevel: 'L1',
          tenantId: 't-1',
          decisionPacketId: 'dp-1',
        }),
      });
      expect(result.intents[1]).toMatchObject({
        _tag: 'record',
        typename: 'AuditArtifact',
        fields: expect.objectContaining({
          decisionPacketId: 'dp-1',
        }),
      });
      // No DynamoDB calls — all writes are intents
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should return record(ComplianceCheck) with BLOCKED result when mandate is found and engine returns BLOCKED', async () => {
      getMandateSnapshot.mockResolvedValue(mandate);
      evaluateSpy.mockReturnValue({
        result: 'BLOCKED',
        violations: [{ rule: 'MANDATE_VIOLATION', description: 'Over cap', severity: 'BLOCKING' }],
        authorityLevel: 'L2',
      });

      const harness = makeHarness();
      const result = await harness.process([
        fakeSqsRecord('DECISION_PACKET_CREATED', decisionPayload, { tenantId: 't-1' }),
      ]);

      expect(result.batchItemFailures).toHaveLength(0);
      expect(result.intents).toHaveLength(2);
      expect(result.intents[0]).toMatchObject({
        _tag: 'record',
        typename: 'ComplianceCheck',
        fields: expect.objectContaining({ result: 'BLOCKED', status: 'COMPLETED' }),
      });
    });

    it('should return record(ComplianceCheck, { status: BLOCKED, reason: No mandate }) when no mandate found', async () => {
      getMandateSnapshot.mockResolvedValue(null);

      const harness = makeHarness();
      const result = await harness.process([
        fakeSqsRecord('DECISION_PACKET_CREATED', {
          ...decisionPayload,
          decisionId: 'dp-nomandante',
        }, { tenantId: 't-1' }),
      ]);

      expect(result.batchItemFailures).toHaveLength(0);
      expect(result.intents).toHaveLength(1);
      expect(result.intents[0]).toMatchObject({
        _tag: 'record',
        typename: 'ComplianceCheck',
        fields: expect.objectContaining({
          status: 'BLOCKED',
          result: 'BLOCKED',
        }),
      });
      expect(evaluateSpy).not.toHaveBeenCalled();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should report failure when DECISION_PACKET_CREATED is missing required fields', async () => {
      const harness = makeHarness();
      const result = await harness.process([
        fakeSqsRecord('DECISION_PACKET_CREATED', {
          decisionId: 'dp-missing',
          tenantId: 't-1',
          userId: 'u-1',
          // Missing: proposedTrades, portfolioValue, riskScore, currentPositions
        }, { tenantId: 't-1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(1);
      expect(getMandateSnapshot).not.toHaveBeenCalled();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should skip unknown event types gracefully', async () => {
      const harness = makeHarness();
      const result = await harness.process([
        fakeSqsRecord('UNKNOWN_EVENT', {}, { tenantId: 't-1' }),
      ]);
      expect(result.skipped).toBe(1);
    });

    it('should propagate errors from getMandateSnapshot as batch item failures', async () => {
      getMandateSnapshot.mockRejectedValue(new Error('DDB error'));

      const harness = makeHarness();
      const result = await harness.process([
        fakeSqsRecord('DECISION_PACKET_CREATED', decisionPayload, { tenantId: 't-1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(1);
    });

    it('should process DECISION_PACKET_UPDATED the same way as DECISION_PACKET_CREATED', async () => {
      getMandateSnapshot.mockResolvedValue(mandate);
      evaluateSpy.mockReturnValue({ result: 'APPROVED', violations: [], authorityLevel: 'L1' });

      const harness = makeHarness();
      const result = await harness.process([
        fakeSqsRecord('DECISION_PACKET_UPDATED', decisionPayload, { tenantId: 't-1' }),
      ]);

      expect(result.batchItemFailures).toHaveLength(0);
      expect(result.intents).toHaveLength(2);
      expect(result.intents[0]._tag).toBe('record');
    });
  });

  describe('mandate events', () => {
    it('MANDATE_CREATED → project(MandateSnapshot) with mandate fields', async () => {
      const harness = makeHarness();
      const result = await harness.process([
        fakeSqsRecord('MANDATE_CREATED', {
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
      expect(result.intents).toHaveLength(1);
      expect(result.intents[0]).toMatchObject({
        _tag: 'project',
        typename: 'MandateSnapshot',
        fields: expect.objectContaining({
          mandateId: 'm-1',
          level: 'DISCRETIONARY',
          revokedAt: null,
        }),
      });
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('MANDATE_UPDATED → project(MandateSnapshot) with updated fields', async () => {
      const harness = makeHarness();
      const result = await harness.process([
        fakeSqsRecord('MANDATE_UPDATED', {
          tenantId: 't-1',
          userId: 'u-1',
          mandateId: 'm-2',
          level: 'DISCRETIONARY',
          monthlyTurnoverCapPercent: 5,
          maxSingleTradePercent: 3,
          equityRiskBandPercent: 3,
          driftTriggerPercent: 2,
          singleEtfConcentrationPercent: 20,
          drawdownCircuitBreakerPercent: 8,
          effectiveDate: '2025-06-01T00:00:00.000Z',
        }, { tenantId: 't-1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(0);
      expect(result.intents[0]).toMatchObject({ _tag: 'project', typename: 'MandateSnapshot' });
    });

    it('MANDATE_UPDATED with revokedAt → project(MandateSnapshot) preserving revokedAt', async () => {
      const harness = makeHarness();
      const result = await harness.process([
        fakeSqsRecord('MANDATE_UPDATED', {
          tenantId: 't-1',
          userId: 'u-1',
          mandateId: 'm-1',
          level: 'DISCRETIONARY',
          monthlyTurnoverCapPercent: 10,
          maxSingleTradePercent: 5,
          equityRiskBandPercent: 6,
          driftTriggerPercent: 4,
          singleEtfConcentrationPercent: 30,
          drawdownCircuitBreakerPercent: 12,
          effectiveDate: '2025-01-01T00:00:00.000Z',
          revokedAt: '2025-01-01T00:00:00.000Z',
        }, { tenantId: 't-1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(0);
      expect(result.intents).toHaveLength(1);
      expect(result.intents[0]).toMatchObject({
        _tag: 'project',
        typename: 'MandateSnapshot',
        fields: expect.objectContaining({
          mandateId: 'm-1',
          revokedAt: '2025-01-01T00:00:00.000Z',
        }),
      });
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('OPERATING_MODE_CHANGED → skip (no intents, no DDB calls)', async () => {
      const harness = makeHarness();
      const result = await harness.process([
        fakeSqsRecord('OPERATING_MODE_CHANGED', {
          tenantId: 't-1', mode: 'AUTONOMOUS',
        }, { tenantId: 't-1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(0);
      expect(result.intents).toHaveLength(1);
      expect(result.intents[0]).toMatchObject({ _tag: 'skip' });
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should throw NotRetryableError on MANDATE_CREATED with missing mandateId/level', async () => {
      const harness = makeHarness();
      const result = await harness.process([
        fakeSqsRecord('MANDATE_CREATED', {
          tenantId: 't-1',
          userId: 'u-1',
          // mandateId and level are missing
        }, { tenantId: 't-1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(1);
    });
  });
});
