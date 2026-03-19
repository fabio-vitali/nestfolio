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

  const getUUID = () => require('crypto').randomUUID();
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

describe('OnboardingRepository', () => {
  let repo: OnboardingRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new OnboardingRepository('test-table');
  });

  describe('createSession', () => {
    it('writes OnboardingSession + EditEvent in transaction', async () => {
      mockSend.mockResolvedValueOnce({});
      const result = await repo.createSession('tenant-1', 'user-1', 'mem-session-1');
      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.TransactItems).toHaveLength(2);
      expect(call.input.TransactItems[0].Put.Item.sk).toMatch(/^OnboardingSession#/);
      expect(call.input.TransactItems[0].Put.Item.currentPhase).toBe('goal');
      expect(call.input.TransactItems[1].Put.Item.__typename).toBe('EditEvent');
      expect(result.sessionId).toBeDefined();
      expect(result.currentPhase).toBe('goal');
    });
  });

  describe('commitHorizon', () => {
    it('queries existing goal and updates timeHorizonMonths', async () => {
      mockSend.mockResolvedValueOnce({ Items: [{ pk: 'InvestorProfile#tenant-1#user-1', sk: 'Goal#g1' }] });
      mockSend.mockResolvedValueOnce({});
      mockSend.mockResolvedValueOnce({});
      await repo.commitHorizon('tenant-1', 'user-1', 10);
      expect(mockSend).toHaveBeenCalledTimes(3);
    });

    it('does nothing when no goal exists', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      await repo.commitHorizon('tenant-1', 'user-1', 10);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('commitGoal', () => {
    it('writes Goal record + EditEvent', async () => {
      mockSend.mockResolvedValueOnce({});
      await repo.commitGoal('tenant-1', 'user-1', 'Far crescere il capitale');
      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.TransactItems).toHaveLength(2);
      expect(call.input.TransactItems[0].Put.Item.__typename).toBe('Goal');
      expect(call.input.TransactItems[0].Put.Item.objective).toBe('Far crescere il capitale');
    });
  });

  describe('commitAccountMode', () => {
    it('writes AccountMode record + EditEvent', async () => {
      mockSend.mockResolvedValueOnce({});
      await repo.commitAccountMode('tenant-1', 'user-1', 'simulation', 10000);
      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.TransactItems[0].Put.Item.sk).toBe('AccountMode');
      expect(call.input.TransactItems[0].Put.Item.mode).toBe('simulation');
      expect(call.input.TransactItems[0].Put.Item.capitalAmount).toBe(10000);
    });
  });

  describe('commitRiskProfile', () => {
    it('writes RiskProfile record + EditEvent', async () => {
      mockSend.mockResolvedValueOnce({});
      await repo.commitRiskProfile('tenant-1', 'user-1', {
        tolerance: 'hold',
        experienceLevel: 'novice',
        score: 25,
        category: 'conservative',
      });
      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.TransactItems[0].Put.Item.__typename).toBe('RiskProfile');
      expect(call.input.TransactItems[0].Put.Item.score).toBe(25);
    });
  });

  describe('commitOperatingMode', () => {
    it('writes OperatingMode + updates InvestorProfile + EditEvent', async () => {
      mockSend.mockResolvedValueOnce({});
      await repo.commitOperatingMode('tenant-1', 'user-1', 'balanced');
      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.TransactItems).toHaveLength(3);
    });
  });

  describe('commitMandate', () => {
    it('writes Mandate record + EditEvent', async () => {
      mockSend.mockResolvedValueOnce({});
      await repo.commitMandate('tenant-1', 'user-1');
      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.TransactItems[0].Put.Item.__typename).toBe('Mandate');
    });
  });

  describe('advanceSession', () => {
    it('updates session phase and phaseIndex', async () => {
      mockSend.mockResolvedValueOnce({ Attributes: { currentPhase: 'horizon', phaseIndex: 1 } });
      await repo.advanceSession('tenant-1', 'user-1', 'sess-1', 'horizon', 1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.Key.sk).toBe('OnboardingSession#sess-1');
    });
  });

  describe('getActiveSession', () => {
    it('returns session if exists and not completed', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [{ sessionId: 'sess-1', currentPhase: 'capital', phaseIndex: 3 }],
      });
      const result = await repo.getActiveSession('tenant-1', 'user-1');
      expect(result).toEqual({ sessionId: 'sess-1', currentPhase: 'capital', phaseIndex: 3 });
    });

    it('returns null if no active session', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      const result = await repo.getActiveSession('tenant-1', 'user-1');
      expect(result).toBeNull();
    });
  });
});
