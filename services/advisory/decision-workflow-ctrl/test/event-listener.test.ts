/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
const mockSend = jest.fn();
const mockSfnSend = jest.fn();

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

jest.mock('@aws-sdk/client-sfn', () => ({
  SFNClient: jest.fn().mockImplementation(() => ({ send: mockSfnSend })),
  StartExecutionCommand: jest.fn().mockImplementation((input) => ({ _type: 'StartExecution', input })),
  SendTaskSuccessCommand: jest.fn().mockImplementation((input) => ({ _type: 'SendTaskSuccess', input })),
}));

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
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  requireEnv: (name: string) => process.env[name] ?? name,
  withMethodLogging: jest.fn().mockReturnValue((_name: string, fn: (...args: unknown[]) => unknown) => fn),
}));

process.env.TABLE_NAME = 'test-table';
process.env.BUS_NAME = 'test-bus';
process.env.STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123:stateMachine:test-sm';

import { createTestHarness, fakeSqsRecord } from '@nestfolio/event-processor';
import { createHandlers, type EventListenerDeps } from '../src/handlers/event-listener';
import { DecisionPacketRepository } from '../src/repositories/decision-packet.repository';

describe('decision-workflow-ctrl event-listener', () => {
  const repository = new DecisionPacketRepository('test-table');

  const mockDeps: EventListenerDeps = {
    repository,
    sfnSend: mockSfnSend,
    stateMachineArn: 'arn:aws:states:us-east-1:123:stateMachine:test-sm',
  };

  const harness = createTestHarness({
    serviceName: 'decision-workflow-ctrl',
    handlers: createHandlers(mockDeps),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
    mockSfnSend.mockResolvedValue({ executionArn: 'arn:aws:states:us-east-1:123:execution:sm:exec-1' });
  });

  // --- Trigger events ---

  describe('trigger events → startExecution', () => {
    it('should start SF execution for MANDATE_GRANTED', async () => {
      const result = await harness.process([
        fakeSqsRecord('MANDATE_GRANTED', {
          tenantId: 't1', userId: 'u1',
        }, { tenantId: 't1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockSfnSend).toHaveBeenCalledTimes(1);
      const startCall = mockSfnSend.mock.calls[0][0];
      expect(startCall._type).toBe('StartExecution');
      expect(startCall.input.stateMachineArn).toBe('arn:aws:states:us-east-1:123:stateMachine:test-sm');
    });

    it('should start SF execution for PORTFOLIO_DRIFT_DETECTED', async () => {
      const result = await harness.process([
        fakeSqsRecord('PORTFOLIO_DRIFT_DETECTED', {
          tenantId: 't1',
        }, { tenantId: 't1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockSfnSend).toHaveBeenCalledTimes(1);
    });

    it('should create DecisionPacket for trigger events', async () => {
      await harness.process([
        fakeSqsRecord('GOAL_UPDATED', {
          tenantId: 't1',
        }, { tenantId: 't1' }),
      ]);
      // Should call DDB put for DecisionPacket creation
      const ddbCalls = mockSend.mock.calls.filter((c) => c[0]._type === 'Put');
      expect(ddbCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle duplicate trigger gracefully (idempotent)', async () => {
      const condError = new Error('Condition not met');
      condError.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(condError);

      const result = await harness.process([
        fakeSqsRecord('MANDATE_GRANTED', {
          tenantId: 't1',
        }, { tenantId: 't1' }),
      ]);
      // Duplicate should not fail the batch — skip gracefully
      expect(result.batchItemFailures).toHaveLength(0);
    });
  });

  // --- Agent completion events ---

  describe('agent completion events → SendTaskSuccess', () => {
    it('should call SendTaskSuccess for INVESTOR_PROFILE_COMPLETED', async () => {
      const result = await harness.process([
        fakeSqsRecord('INVESTOR_PROFILE_COMPLETED', {
          decisionId: 'dp-1',
          tenantId: 't1',
          taskToken: 'token-abc',
          outputs: { riskScore: 0.45 },
        }, { tenantId: 't1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockSfnSend).toHaveBeenCalledTimes(1);
      const call = mockSfnSend.mock.calls[0][0];
      expect(call._type).toBe('SendTaskSuccess');
      expect(call.input.taskToken).toBe('token-abc');
    });

    it('should call SendTaskSuccess for MARKET_ANALYSIS_COMPLETED', async () => {
      await harness.process([
        fakeSqsRecord('MARKET_ANALYSIS_COMPLETED', {
          decisionId: 'dp-1',
          tenantId: 't1',
          taskToken: 'token-def',
          outputs: { sentiment: 'bullish' },
        }, { tenantId: 't1' }),
      ]);
      expect(mockSfnSend).toHaveBeenCalledTimes(1);
      const call = mockSfnSend.mock.calls[0][0];
      expect(call._type).toBe('SendTaskSuccess');
      expect(call.input.taskToken).toBe('token-def');
    });

    it('should call SendTaskSuccess for PORTFOLIO_COMPLETED', async () => {
      await harness.process([
        fakeSqsRecord('PORTFOLIO_COMPLETED', {
          decisionId: 'dp-1',
          tenantId: 't1',
          taskToken: 'token-ghi',
          outputs: { allocations: [] },
        }, { tenantId: 't1' }),
      ]);
      const call = mockSfnSend.mock.calls[0][0];
      expect(call._type).toBe('SendTaskSuccess');
    });

    it('should call SendTaskSuccess for NARRATIVE_COMPLETED', async () => {
      await harness.process([
        fakeSqsRecord('NARRATIVE_COMPLETED', {
          decisionId: 'dp-1',
          tenantId: 't1',
          taskToken: 'token-jkl',
          outputs: { narrative: 'Based on...' },
        }, { tenantId: 't1' }),
      ]);
      const call = mockSfnSend.mock.calls[0][0];
      expect(call._type).toBe('SendTaskSuccess');
    });

    it('should store agent output in DDB', async () => {
      await harness.process([
        fakeSqsRecord('INVESTOR_PROFILE_COMPLETED', {
          decisionId: 'dp-1',
          tenantId: 't1',
          taskToken: 'token-abc',
          outputs: { riskScore: 0.45 },
        }, { tenantId: 't1' }),
      ]);
      const putCalls = mockSend.mock.calls.filter((c) => c[0]._type === 'Put');
      expect(putCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  // --- Compliance events ---

  describe('compliance events → SendTaskSuccess', () => {
    it('should resume SF for DECISION_APPROVED', async () => {
      const result = await harness.process([
        fakeSqsRecord('DECISION_APPROVED', {
          decisionId: 'dp-1',
          tenantId: 't1',
          taskToken: 'token-compliance',
          authorityLevel: 'L1',
        }, { tenantId: 't1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockSfnSend).toHaveBeenCalledTimes(1);
      const call = mockSfnSend.mock.calls[0][0];
      expect(call._type).toBe('SendTaskSuccess');
      expect(JSON.parse(call.input.output)).toMatchObject({
        decision: 'APPROVED',
        authorityLevel: 'L1',
      });
    });

    it('should resume SF for DECISION_BLOCKED', async () => {
      await harness.process([
        fakeSqsRecord('DECISION_BLOCKED', {
          decisionId: 'dp-1',
          tenantId: 't1',
          taskToken: 'token-compliance-2',
          reason: 'Exceeds risk limits',
        }, { tenantId: 't1' }),
      ]);
      const call = mockSfnSend.mock.calls[0][0];
      expect(call._type).toBe('SendTaskSuccess');
      expect(JSON.parse(call.input.output)).toMatchObject({
        decision: 'BLOCKED',
      });
    });

    it('should update DDB status for compliance events', async () => {
      await harness.process([
        fakeSqsRecord('DECISION_APPROVED', {
          decisionId: 'dp-1',
          tenantId: 't1',
          taskToken: 'token-compliance',
          authorityLevel: 'L1',
        }, { tenantId: 't1' }),
      ]);
      const transactCalls = mockSend.mock.calls.filter((c) => c[0]._type === 'TransactWrite');
      expect(transactCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  // --- User response events ---

  describe('user response events → SendTaskSuccess', () => {
    it('should resume SF for USER_CONFIRMED', async () => {
      const result = await harness.process([
        fakeSqsRecord('USER_CONFIRMED', {
          decisionId: 'dp-1',
          tenantId: 't1',
          taskToken: 'token-user',
        }, { tenantId: 't1' }),
      ]);
      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockSfnSend).toHaveBeenCalledTimes(1);
      const call = mockSfnSend.mock.calls[0][0];
      expect(JSON.parse(call.input.output)).toMatchObject({
        decision: 'CONFIRMED',
      });
    });

    it('should resume SF for USER_REJECTED', async () => {
      await harness.process([
        fakeSqsRecord('USER_REJECTED', {
          decisionId: 'dp-1',
          tenantId: 't1',
          taskToken: 'token-user-2',
          reason: 'Too risky',
        }, { tenantId: 't1' }),
      ]);
      const call = mockSfnSend.mock.calls[0][0];
      expect(JSON.parse(call.input.output)).toMatchObject({
        decision: 'REJECTED',
        reason: 'Too risky',
      });
    });

    it('should update DDB status for user response events', async () => {
      await harness.process([
        fakeSqsRecord('USER_CONFIRMED', {
          decisionId: 'dp-1',
          tenantId: 't1',
          taskToken: 'token-user',
        }, { tenantId: 't1' }),
      ]);
      const transactCalls = mockSend.mock.calls.filter((c) => c[0]._type === 'TransactWrite');
      expect(transactCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  // --- Unknown events ---

  it('should skip unknown event types gracefully', async () => {
    const result = await harness.process([
      fakeSqsRecord('UNKNOWN_EVENT', {}, { tenantId: 't1' }),
    ]);
    expect(result.skipped).toBe(1);
  });
});
