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
import { RuleEngine } from '../../src/rules/rule-engine';
import { MandateValidator } from '../../src/rules/mandate-validator';
import { GuardrailEvaluator } from '../../src/rules/guardrail-evaluator';
import { SuitabilityChecker } from '../../src/rules/suitability-checker';
import { AuthorityResolver } from '../../src/rules/authority-resolver';
import { createHandlers, type EventListenerDeps } from '../../src/handlers/event-listener';

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
    taskToken: 'integ-task-token',
    awaitingCompliance: true,
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
    portfolioValueCents: 10_000_000,
    riskCategory: 'MODERATE',
    isInitialBuild: false,
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
        fakeSqsRecord('RECOMMENDATION_PROPOSED', decisionPayload, { tenantId: 't-1' }),
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
          // Bug D regression: CDC subject must carry `decisionId` so
          // advisory-bff's decision-status-changed transform can
          // address `Decision#${tenantId}#${decisionId}`.
          decisionId: 'dp-1',
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
        fakeSqsRecord('RECOMMENDATION_PROPOSED', decisionPayload, { tenantId: 't-1' }),
      ]);

      expect(result.batchItemFailures).toHaveLength(0);
      expect(result.intents).toHaveLength(2);
      expect(result.intents[0]).toMatchObject({
        _tag: 'record',
        typename: 'ComplianceCheck',
        fields: expect.objectContaining({
          result: 'BLOCKED',
          status: 'COMPLETED',
          decisionPacketId: 'dp-1',
          // Bug D regression: dual-field write so DECISION_BLOCKED's
          // CDC subject carries decisionId for advisory-bff.
          decisionId: 'dp-1',
        }),
      });
    });

    it('should return record(ComplianceCheck, { status: BLOCKED, reason: No mandate }) when no mandate found', async () => {
      getMandateSnapshot.mockResolvedValue(null);

      const harness = makeHarness();
      const result = await harness.process([
        fakeSqsRecord('RECOMMENDATION_PROPOSED', {
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
          taskToken: 'integ-task-token',
          decisionPacketId: 'dp-nomandante',
          // Bug D regression: dual-field on the MANDATE_MISSING
          // fallback path too — same CDC subject contract.
          decisionId: 'dp-nomandante',
        }),
      });
      expect(evaluateSpy).not.toHaveBeenCalled();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should report failure when RECOMMENDATION_PROPOSED is missing required fields', async () => {
      const harness = makeHarness();
      const result = await harness.process([
        fakeSqsRecord('RECOMMENDATION_PROPOSED', {
          decisionId: 'dp-missing',
          tenantId: 't-1',
          userId: 'u-1',
          taskToken: 'tok',
          // Missing: proposedTrades, portfolioValueCents, currentPositions
          // (riskCategory + isInitialBuild have sane defaults and are NOT required)
        }, { tenantId: 't-1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(1);
      expect(getMandateSnapshot).not.toHaveBeenCalled();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should report failure when RECOMMENDATION_PROPOSED is missing taskToken', async () => {
      const harness = makeHarness();
      const noTokenPayload = { ...decisionPayload };
      delete (noTokenPayload as Record<string, unknown>).taskToken;
      const result = await harness.process([
        fakeSqsRecord('RECOMMENDATION_PROPOSED', noTokenPayload, { tenantId: 't-1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(1);
      expect(getMandateSnapshot).not.toHaveBeenCalled();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('builds ComplianceInput with isInitialBuild + riskCategory + portfolioValueCents from RECOMMENDATION_PROPOSED subject', async () => {
      getMandateSnapshot.mockResolvedValue(mandate);
      const captured: unknown[] = [];
      evaluateSpy.mockImplementation((input: unknown) => {
        captured.push(input);
        return { result: 'APPROVED' as const, authorityLevel: 'L2' as const, violations: [], checks: [] };
      });

      const harness = makeHarness();
      await harness.process([
        fakeSqsRecord('RECOMMENDATION_PROPOSED', {
          decisionId: 'dec-1',
          tenantId: 't-1',
          userId: 'u-1',
          taskToken: 'tt-1',
          proposedTrades: [
            { symbol: 'VTI', assetClass: 'EQUITY', side: 'BUY', quantityOrAmountCents: 14_000, targetWeightPercent: 14, rationale: 'x' },
          ],
          portfolioValueCents: 100_000,
          riskCategory: 'MODERATE',
          isInitialBuild: true,
          currentPositions: [],
        }, { tenantId: 't-1' }),
      ]);

      expect(captured[0]).toMatchObject({
        portfolioValueCents: 100_000,
        riskCategory: 'MODERATE',
        isInitialBuild: true,
      });
      expect(captured[0]).not.toHaveProperty('portfolioValue');
      expect(captured[0]).not.toHaveProperty('riskScore');
    });

    it('defaults riskCategory to MODERATE when subject is missing the field', async () => {
      getMandateSnapshot.mockResolvedValue(mandate);
      const captured: unknown[] = [];
      evaluateSpy.mockImplementation((input: unknown) => {
        captured.push(input);
        return { result: 'APPROVED' as const, authorityLevel: 'L2' as const, violations: [], checks: [] };
      });

      const harness = makeHarness();
      await harness.process([
        fakeSqsRecord('RECOMMENDATION_PROPOSED', {
          decisionId: 'dec-2',
          tenantId: 't-1',
          userId: 'u-1',
          taskToken: 'tt-2',
          proposedTrades: [],
          portfolioValueCents: 50_000,
          // riskCategory intentionally omitted
          isInitialBuild: false,
          currentPositions: [],
        }, { tenantId: 't-1' }),
      ]);

      expect((captured[0] as Record<string, unknown>).riskCategory).toBe('MODERATE');
    });

    it('defaults isInitialBuild to false when subject is missing the field', async () => {
      getMandateSnapshot.mockResolvedValue(mandate);
      const captured: unknown[] = [];
      evaluateSpy.mockImplementation((input: unknown) => {
        captured.push(input);
        return { result: 'APPROVED' as const, authorityLevel: 'L2' as const, violations: [], checks: [] };
      });

      const harness = makeHarness();
      await harness.process([
        fakeSqsRecord('RECOMMENDATION_PROPOSED', {
          decisionId: 'dec-3',
          tenantId: 't-1',
          userId: 'u-1',
          taskToken: 'tt-3',
          proposedTrades: [],
          portfolioValueCents: 50_000,
          riskCategory: 'CONSERVATIVE',
          // isInitialBuild intentionally omitted
          currentPositions: [],
        }, { tenantId: 't-1' }),
      ]);

      expect((captured[0] as Record<string, unknown>).isInitialBuild).toBe(false);
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
        fakeSqsRecord('RECOMMENDATION_PROPOSED', decisionPayload, { tenantId: 't-1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(1);
    });

    it('should persist taskToken on the ComplianceCheck record so CDC re-emits it on DECISION_APPROVED', async () => {
      getMandateSnapshot.mockResolvedValue(mandate);
      evaluateSpy.mockReturnValue({ result: 'APPROVED', violations: [], authorityLevel: 'L1' });

      const harness = makeHarness();
      const result = await harness.process([
        fakeSqsRecord('RECOMMENDATION_PROPOSED', decisionPayload, { tenantId: 't-1' }),
      ]);

      expect(result.batchItemFailures).toHaveLength(0);
      expect(result.intents).toHaveLength(2);
      expect(result.intents[0]).toMatchObject({
        _tag: 'record',
        typename: 'ComplianceCheck',
        fields: expect.objectContaining({ taskToken: 'integ-task-token' }),
      });
    });
  });

  describe('Mandate projection (projectVersioned)', () => {
    const fullMandate = (overrides: Record<string, unknown> = {}) => ({
      tenantId: 't-1', userId: 'u-1', mandateId: 'm-1',
      level: 'DISCRETIONARY', status: 'ACTIVE', operatingMode: 'BALANCED',
      effectiveDate: '2025-01-01T00:00:00.000Z', __version: 1,
      ...overrides,
    });

    it('MANDATE_ISSUED → projectVersioned(MandateSnapshot) full row keyed on __version', async () => {
      const harness = makeHarness();
      const result = await harness.process([
        fakeSqsRecord('MANDATE_ISSUED', fullMandate(), { tenantId: 't-1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(0);
      expect(result.intents).toHaveLength(1);
      expect(result.intents[0]).toMatchObject({
        _tag: 'projectVersioned', typename: 'MandateSnapshot', version: 1,
        fields: expect.objectContaining({
          tenantId: 't-1', userId: 'u-1', mandateId: 'm-1',
          level: 'DISCRETIONARY', status: 'ACTIVE', operatingMode: 'BALANCED',
          effectiveDate: '2025-01-01T00:00:00.000Z',
        }),
        overrides: { pk: 'GuardrailPolicy#t-1#u-1', sk: 'MandateSnapshot' },
      });
    });

    it('OPERATING_MODE_CHANGED → projectVersioned full row (status/level preserved) at the new __version', async () => {
      const harness = makeHarness();
      const result = await harness.process([
        fakeSqsRecord('OPERATING_MODE_CHANGED', fullMandate({ operatingMode: 'AGGRESSIVE', __version: 2 }), { tenantId: 't-1' }),
      ]);
      expect(result.intents[0]).toMatchObject({
        _tag: 'projectVersioned', typename: 'MandateSnapshot', version: 2,
        fields: expect.objectContaining({ operatingMode: 'AGGRESSIVE', status: 'ACTIVE', level: 'DISCRETIONARY', mandateId: 'm-1' }),
      });
    });

    it('MANDATE_REVOKED → projectVersioned full row with status=REVOKED at the new __version', async () => {
      const harness = makeHarness();
      const result = await harness.process([
        fakeSqsRecord('MANDATE_REVOKED', fullMandate({ status: 'REVOKED', revokedAt: '2026-05-03T12:00:00.000Z', __version: 3 }), { tenantId: 't-1' }),
      ]);
      expect(result.intents[0]).toMatchObject({
        _tag: 'projectVersioned', typename: 'MandateSnapshot', version: 3,
        fields: expect.objectContaining({ status: 'REVOKED', revokedAt: '2026-05-03T12:00:00.000Z', mandateId: 'm-1', level: 'DISCRETIONARY' }),
      });
    });

    it('Mandate event missing operatingMode → batch item failure (NotRetryableError)', async () => {
      const harness = makeHarness();
      const result = await harness.process([
        fakeSqsRecord('MANDATE_ISSUED', { tenantId: 't-1', userId: 'u-1', mandateId: 'm-1', level: 'DISCRETIONARY', __version: 1 }, { tenantId: 't-1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(1);
    });

    it('Mandate event missing __version → no MandateSnapshot write, no failure (skip)', async () => {
      const harness = makeHarness();
      const result = await harness.process([
        fakeSqsRecord('MANDATE_ISSUED', { tenantId: 't-1', userId: 'u-1', mandateId: 'm-1', level: 'DISCRETIONARY', operatingMode: 'BALANCED' }, { tenantId: 't-1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(0);
      // No projectVersioned MandateSnapshot write — the handler returned skip().
      // result.intents[0]._tag === 'skip' (the skip intent is surfaced in the intents array).
      expect(result.intents.some((i) => i._tag === 'projectVersioned')).toBe(false);
    });
  });
});
