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
      try {
        await this.docClient.send(new PutCommand({ TableName: this.tableName, Item: item }));
        return true;
      } catch {
        return false;
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

  requireEnv: (name: string) => process.env[name] ?? name,
  withMethodLogging: jest.fn().mockReturnValue((_name: string, fn: (...args: unknown[]) => unknown) => fn),

}));
process.env.TABLE_NAME = 'test-table';

import { createTestHarness, fakeSqsRecord } from '@nestfolio/event-processor';
import { DecisionRepository } from '../../src/repositories/decision.repository';
import { DecisionLifecycleService } from '../../src/services/decision-lifecycle.service';
import { createHandlers, type EventListenerDeps } from '../../src/handlers/event-listener';

describe('event-listener handler', () => {
  const repository = new DecisionRepository('test-table');
  const lifecycleService = new DecisionLifecycleService(repository);

  const mockDeps: EventListenerDeps = {
    lifecycleService,
  };

  const harness = createTestHarness({
    serviceName: 'advisory-ctrl',
    handlers: createHandlers(mockDeps),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
  });

  it('should process MANDATE_CREATED trigger event and return skip()', async () => {
    const result = await harness.process([
      fakeSqsRecord('MANDATE_CREATED', {
        tenantId: 't1', userId: 'u1',
      }, { tenantId: 't1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(result.intents).toHaveLength(1);
    expect(result.intents[0]).toMatchObject({ _tag: 'skip' });
  });

  it('should process GOAL_UPDATED trigger event and return skip()', async () => {
    const result = await harness.process([
      fakeSqsRecord('GOAL_UPDATED', {
        tenantId: 't1',
      }, { tenantId: 't1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(result.intents).toHaveLength(1);
    expect(result.intents[0]).toMatchObject({ _tag: 'skip' });
  });

  it('should skip unknown event types gracefully', async () => {
    const result = await harness.process([
      fakeSqsRecord('UNKNOWN_EVENT', {}, { tenantId: 't1' }),
    ]);
    expect(result.skipped).toBe(1);
  });

  it('should report batch item failures for processing errors', async () => {
    // Trigger an error by causing the lifecycle service to throw
    const lifecycleSpy = jest.spyOn(lifecycleService, 'executeDecisionLifecycle')
      .mockRejectedValueOnce(new Error('Lifecycle failed'));

    const result = await harness.process([
      fakeSqsRecord('MANDATE_CREATED', {
        tenantId: 't1', userId: 'u1',
      }, { tenantId: 't1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(1);
    lifecycleSpy.mockRestore();
  });

  it('should handle duplicate events gracefully via conditional write', async () => {
    const { ConditionalCheckFailedException } = { ConditionalCheckFailedException: class extends Error { name = 'ConditionalCheckFailedException'; } };
    mockSend.mockRejectedValueOnce(new ConditionalCheckFailedException('Condition not met'));

    const result = await harness.process([
      fakeSqsRecord('MANDATE_CREATED', {
        tenantId: 't1',
      }, { tenantId: 't1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(0);
  });

  // Compliance callback tests
  describe('compliance callback events — WriteIntents', () => {
    it('DECISION_APPROVED with L1 authority → update() with status APPROVED', async () => {
      const result = await harness.process([
        fakeSqsRecord('DECISION_APPROVED', {
          tenantId: 't1', decisionId: 'dp-1', authorityLevel: 'L1',
        }, { tenantId: 't1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(0);
      expect(result.intents).toHaveLength(1);
      expect(result.intents[0]).toMatchObject({
        _tag: 'update',
        typename: 'DecisionPacket',
        updates: {
          status: 'APPROVED',
          complianceResult: 'APPROVED',
          authorityLevel: 'L1',
        },
        overrides: {
          pk: 'DecisionPacket#t1#dp-1',
          sk: 'DecisionPacket',
        },
      });
    });

    it('DECISION_APPROVED with L2 authority → update() with status AWAITING_CONFIRMATION', async () => {
      const result = await harness.process([
        fakeSqsRecord('DECISION_APPROVED', {
          tenantId: 't1', decisionId: 'dp-2', authorityLevel: 'L2',
        }, { tenantId: 't1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(0);
      expect(result.intents).toHaveLength(1);
      expect(result.intents[0]).toMatchObject({
        _tag: 'update',
        typename: 'DecisionPacket',
        updates: {
          status: 'AWAITING_CONFIRMATION',
          complianceResult: 'APPROVED',
          authorityLevel: 'L2',
        },
        overrides: {
          pk: 'DecisionPacket#t1#dp-2',
          sk: 'DecisionPacket',
        },
      });
    });

    it('DECISION_BLOCKED → update() with status BLOCKED and blockReason', async () => {
      const result = await harness.process([
        fakeSqsRecord('DECISION_BLOCKED', {
          tenantId: 't1', decisionId: 'dp-3', reason: 'Exceeds risk limits',
        }, { tenantId: 't1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(0);
      expect(result.intents).toHaveLength(1);
      expect(result.intents[0]).toMatchObject({
        _tag: 'update',
        typename: 'DecisionPacket',
        updates: {
          status: 'BLOCKED',
          complianceResult: 'BLOCKED',
          blockReason: 'Exceeds risk limits',
        },
        overrides: {
          pk: 'DecisionPacket#t1#dp-3',
          sk: 'DecisionPacket',
        },
      });
    });

    it('DECISION_APPROVED missing decisionId → throws error', async () => {
      const result = await harness.process([
        fakeSqsRecord('DECISION_APPROVED', {
          tenantId: 't1', authorityLevel: 'L1',
        }, { tenantId: 't1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(1);
      expect(result.errors[0].error.message).toContain('Missing decisionId');
    });
  });

  // User response tests
  describe('user response events — WriteIntents', () => {
    it('USER_CONFIRMED → update() with status CONFIRMED and userDecision CONFIRMED', async () => {
      const result = await harness.process([
        fakeSqsRecord('USER_CONFIRMED', {
          tenantId: 't1', decisionId: 'dp-1',
        }, { tenantId: 't1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(0);
      expect(result.intents).toHaveLength(1);
      expect(result.intents[0]).toMatchObject({
        _tag: 'update',
        typename: 'DecisionPacket',
        updates: {
          status: 'CONFIRMED',
          userDecision: 'CONFIRMED',
        },
        overrides: {
          pk: 'DecisionPacket#t1#dp-1',
          sk: 'DecisionPacket',
        },
      });
    });

    it('USER_REJECTED → update() with status REJECTED, userDecision REJECTED, and rejectionReason', async () => {
      const result = await harness.process([
        fakeSqsRecord('USER_REJECTED', {
          tenantId: 't1',
          decisionId: 'dp-2',
          reason: 'Too risky',
        }, { tenantId: 't1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(0);
      expect(result.intents).toHaveLength(1);
      expect(result.intents[0]).toMatchObject({
        _tag: 'update',
        typename: 'DecisionPacket',
        updates: {
          status: 'REJECTED',
          userDecision: 'REJECTED',
          rejectionReason: 'Too risky',
        },
        overrides: {
          pk: 'DecisionPacket#t1#dp-2',
          sk: 'DecisionPacket',
        },
      });
    });

    it('USER_CONFIRMED missing decisionId → throws error', async () => {
      const result = await harness.process([
        fakeSqsRecord('USER_CONFIRMED', {
          tenantId: 't1',
        }, { tenantId: 't1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(1);
      expect(result.errors[0].error.message).toContain('Missing decisionId');
    });
  });
});
