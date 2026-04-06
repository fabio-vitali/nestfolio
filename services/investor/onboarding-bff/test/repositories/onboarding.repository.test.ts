import { OnboardingRepository } from '../../src/repositories/onboarding.repository';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockImplementation(() => ({ send: mockSend })),
  },
  PutCommand: jest.fn().mockImplementation((input) => ({ input })),
  GetCommand: jest.fn().mockImplementation((input) => ({ input })),
  QueryCommand: jest.fn().mockImplementation((input) => ({ input })),
  UpdateCommand: jest.fn().mockImplementation((input) => ({ input })),
  TransactWriteCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

jest.mock('@nestfolio/event-processor', () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
  const { PutCommand, QueryCommand, UpdateCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');

  class MockTableRepository {
    protected readonly docClient: { send: jest.Mock };
    protected readonly tableName: string;

    constructor(tableName: string) {
      this.tableName = tableName;
      this.docClient = DynamoDBDocumentClient.from({});
    }

    protected async put(item: Record<string, unknown>) {
      await this.docClient.send(new PutCommand({ TableName: this.tableName, Item: item }));
    }

    protected async putIfNotExists(item: Record<string, unknown>): Promise<boolean> {
      try {
        await this.docClient.send(new PutCommand({ TableName: this.tableName, Item: item, ConditionExpression: 'attribute_not_exists(pk)' }));
        return true;
      } catch {
        return false;
      }
    }

    protected async queryByPk(pk: string, skPrefix?: string) {
      const result = await this.docClient.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: skPrefix ? 'pk = :pk AND begins_with(sk, :sk)' : 'pk = :pk',
        ExpressionAttributeValues: { ':pk': pk, ...(skPrefix ? { ':sk': skPrefix } : {}) },
      }));
      return result.Items ?? [];
    }

    protected async transactWrite(input: unknown) {
      await this.docClient.send(new TransactWriteCommand(input));
    }

    protected async update(pk: string, sk: string, attrs: Record<string, unknown>) {
      const entries = Object.entries(attrs);
      const names: Record<string, string> = {};
      const values: Record<string, unknown> = {};
      const setClauses: string[] = [];
      entries.forEach(([key, value], i) => {
        names[`#a${i}`] = key;
        values[`:v${i}`] = value;
        setClauses.push(`#a${i} = :v${i}`);
      });
      await this.docClient.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { pk, sk },
        UpdateExpression: `SET ${setClauses.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }));
    }
  }

  const getUUID = () => require('crypto').randomUUID(); // eslint-disable-line @typescript-eslint/no-require-imports
  const getTime = () => new Date().toISOString();

  const withMethodLogging = (_className: string) =>
    (_methodName: string, fn: (...args: unknown[]) => Promise<unknown>) => fn;

  return {
    TableRepository: MockTableRepository,
    getUUID,
    getTime,
    withMethodLogging,
  };
});

const TEST_CTX = { tenantId: 'tenant-1', userId: 'user-1', region: 'us-east-1' };

describe('OnboardingRepository', () => {
  let repo: OnboardingRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new OnboardingRepository('test-table');
  });

  describe('createSession', () => {
    it('creates a session with status in_progress, empty phases, and OnboardingSession pk pattern', async () => {
      mockSend.mockResolvedValueOnce({});
      const result = await repo.createSession('mem-session-1', TEST_CTX as any);
      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.Item.pk).toMatch(/^OnboardingSession#/);
      expect(call.input.Item.sk).toMatch(/^OnboardingSession#/);
      expect(call.input.Item.__typename).toBe('OnboardingSession');
      expect(call.input.Item.status).toBe('in_progress');
      expect(call.input.Item.phases).toEqual({});
      expect(call.input.Item.tenantId).toBe('tenant-1');
      expect(call.input.Item.userId).toBe('user-1');
      expect(call.input.Item.region).toBe('us-east-1');
      expect(result.sessionId).toBeDefined();
      expect(result.status).toBe('in_progress');
    });
  });

  describe('updatePhase', () => {
    it('updates the phases map and advances currentPhase', async () => {
      mockSend.mockResolvedValueOnce({});
      await repo.updatePhase('tenant-1', 'user-1', 'sess-1', 'goal', { objective: 'Growth' }, 'horizon', 1);
      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.UpdateExpression).toContain('phases.#phase');
      expect(call.input.ExpressionAttributeNames['#phase']).toBe('goal');
      expect(call.input.ExpressionAttributeValues[':data']).toEqual({ objective: 'Growth' });
      expect(call.input.ExpressionAttributeValues[':next']).toBe('horizon');
    });
  });

  describe('completeSession', () => {
    it('updates session to completed and writes OnboardingCompleted CDC record in transactWrite', async () => {
      mockSend.mockResolvedValueOnce({});
      const phases = {
        goal: { objective: 'Growth' },
        horizon: { years: 5 },
        mode: { accountMode: 'simulation' as const },
        capital: { amount: 10000, currency: 'EUR' },
        risk: { toleranceIdx: 2, experienceIdx: 1, score: 50, category: 'moderate' as const },
        operatingMode: { mode: 'BALANCED' as const },
        mandate: { accepted: true },
      };
      await repo.completeSession('sess-1', phases, TEST_CTX as any);
      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.TransactItems).toHaveLength(2);
      // Item 1: Update session status
      expect(call.input.TransactItems[0].Update.ExpressionAttributeValues[':status']).toBe('completed');
      // Item 2: Put CDC record
      const cdcItem = call.input.TransactItems[1].Put.Item;
      expect(cdcItem.__typename).toBe('OnboardingCompleted');
      expect(cdcItem.pk).toMatch(/^OnboardingCompleted#/);
      expect(cdcItem.tenantId).toBe('tenant-1');
      expect(cdcItem.userId).toBe('user-1');
      expect(cdcItem.region).toBe('us-east-1');
      expect(cdcItem.horizonYears).toBe(5);
      expect(cdcItem.riskTolerance).toBe(2);
      expect(cdcItem.mandateAccepted).toBe(true);
    });
  });

  describe('confirmGoLive', () => {
    it('updates session to completed and writes GoLiveConfirmed CDC record in transactWrite', async () => {
      mockSend.mockResolvedValueOnce({});
      await repo.confirmGoLive('sess-1', TEST_CTX as any);
      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.TransactItems).toHaveLength(2);
      // Item 1: Update session status
      expect(call.input.TransactItems[0].Update.ExpressionAttributeValues[':status']).toBe('completed');
      expect(call.input.TransactItems[0].Update.ExpressionAttributeValues[':phase']).toBe('go_live_confirmation');
      // Item 2: Put CDC record
      const cdcItem = call.input.TransactItems[1].Put.Item;
      expect(cdcItem.__typename).toBe('GoLiveConfirmed');
      expect(cdcItem.pk).toMatch(/^GoLiveConfirmed#/);
      expect(cdcItem.sk).toMatch(/^GoLiveConfirmed#/);
      expect(cdcItem.tenantId).toBe('tenant-1');
      expect(cdcItem.userId).toBe('user-1');
      expect(cdcItem.region).toBe('us-east-1');
    });
  });

  describe('getActiveSession', () => {
    it('returns session if exists and not completed', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [{ sessionId: 'sess-1', status: 'in_progress', currentPhase: 'capital', phaseIndex: 3 }],
      });
      const result = await repo.getActiveSession('tenant-1', 'user-1');
      expect(result).toEqual({ sessionId: 'sess-1', status: 'in_progress', currentPhase: 'capital', phaseIndex: 3 });
      const call = mockSend.mock.calls[0][0];
      expect(call.input.FilterExpression).toContain('#status');
    });

    it('returns null if no active session', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      const result = await repo.getActiveSession('tenant-1', 'user-1');
      expect(result).toBeNull();
    });
  });
});
