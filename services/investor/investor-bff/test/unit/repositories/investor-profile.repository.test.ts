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
    GetCommand: jest.fn().mockImplementation((input) => ({ _type: 'Get', input })),
    QueryCommand: jest.fn().mockImplementation((input) => ({ _type: 'Query', input })),
    UpdateCommand: jest.fn().mockImplementation((input) => ({ _type: 'Update', input })),
    BatchGetCommand: jest.fn().mockImplementation((input) => ({ _type: 'BatchGet', input })),
    TransactWriteCommand: jest.fn().mockImplementation((input) => ({ _type: 'TransactWrite', input })),
  };
});

jest.mock('@nestfolio/event-processor', () => ({
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
  NotRetryableError: class NotRetryableError extends Error {
    constructor(message: string, public readonly details?: Record<string, unknown>) {
      super(message);
      this.name = 'NotRetryableError';
    }
  },

  withMethodLogging: jest.fn((_className: string) =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),

  EntityNotFoundError: class EntityNotFoundError extends Error {
    constructor(public entityType: string, public entityId: string) {
      super(`${entityType} with id '${entityId}' not found`);
      this.name = 'EntityNotFoundError';
    }
  },

}));
import { InvestorProfileRepository } from '../../../src/repositories/investor-profile.repository';
import type { RequestContext } from '@nestfolio/event-processor';

function ctx(tenantId: string, userId: string): RequestContext {
  return { tenantId, userId, region: 'us-east-1' } as unknown as RequestContext;
}

describe('InvestorProfileRepository', () => {
  let repo: InvestorProfileRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new InvestorProfileRepository('test-table');
  });

  describe('getProfile (composite + MandateStatus via BatchGet)', () => {
    it('returns profile + mandateStatus when both exist', async () => {
      const profile = {
        pk: 'InvestorProfile#t1#u1',
        sk: 'InvestorProfile',
        __typename: 'InvestorProfile',
        tenantId: 't1',
        email: 'test@example.com',
      };
      const mandateStatus = {
        pk: 'InvestorProfile#t1#u1',
        sk: 'MandateStatus',
        __typename: 'MandateStatus',
        status: 'ACTIVE',
      };
      mockSend.mockResolvedValueOnce({ Responses: { 'test-table': [profile, mandateStatus] } });

      const result = await repo.getProfile('t1', 'u1');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call._type).toBe('BatchGet');
      expect(call.input.RequestItems['test-table'].Keys).toEqual([
        { pk: 'InvestorProfile#t1#u1', sk: 'InvestorProfile' },
        { pk: 'InvestorProfile#t1#u1', sk: 'MandateStatus' },
      ]);
      expect(result).toEqual({ profile, mandateStatus });
    });

    it('returns mandateStatus = null when only the InvestorProfile row exists', async () => {
      const profile = {
        pk: 'InvestorProfile#t1#u1',
        sk: 'InvestorProfile',
        __typename: 'InvestorProfile',
      };
      mockSend.mockResolvedValueOnce({ Responses: { 'test-table': [profile] } });

      const result = await repo.getProfile('t1', 'u1');

      expect(result).toEqual({ profile, mandateStatus: null });
    });

    it('is order-independent (BatchGet may return items in any order)', async () => {
      const profile = { pk: 'InvestorProfile#t1#u1', sk: 'InvestorProfile' };
      const mandateStatus = { pk: 'InvestorProfile#t1#u1', sk: 'MandateStatus' };
      mockSend.mockResolvedValueOnce({ Responses: { 'test-table': [mandateStatus, profile] } });

      const result = await repo.getProfile('t1', 'u1');

      expect(result.profile).toEqual(profile);
      expect(result.mandateStatus).toEqual(mandateStatus);
    });

    it('throws EntityNotFoundError when InvestorProfile not found', async () => {
      mockSend.mockResolvedValueOnce({ Responses: { 'test-table': [] } });

      await expect(repo.getProfile('t1', 'u1')).rejects.toThrow('not found');
    });
  });

  describe('setGoal (composite row)', () => {
    it('updates the InvestorProfile.goal nested attribute via UpdateItem', async () => {
      mockSend.mockResolvedValueOnce({});

      const goal = {
        objective: 'GROWTH',
        targetAmountCents: 500000,
        currency: 'EUR',
        timeHorizonMonths: 60,
        targetReturn: 0.07,
      };

      const result = await repo.setGoal(ctx('t1', 'u1'), goal);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call._type).toBe('Update');
      expect(call.input.Key).toEqual({ pk: 'InvestorProfile#t1#u1', sk: 'InvestorProfile' });
      expect(call.input.UpdateExpression).toContain('goal = :goal');
      expect(call.input.UpdateExpression).toContain('updatedAt = :now');
      expect(call.input.ExpressionAttributeValues[':goal']).toEqual(goal);
      expect(call.input.ConditionExpression).toBe('attribute_exists(pk)');
      expect(result).toEqual(goal);
    });
  });

  describe('updateGoal (composite row, no goalId)', () => {
    it('uses dynamic SET expressions on goal.<field> paths', async () => {
      const updatedAttrs = {
        pk: 'InvestorProfile#t1#u1',
        sk: 'InvestorProfile',
        goal: {
          objective: 'Retirement Updated',
          currency: 'EUR',
        },
      };
      mockSend.mockResolvedValueOnce({ Attributes: updatedAttrs });

      const result = await repo.updateGoal(ctx('t1', 'u1'), {
        objective: 'Retirement Updated',
        currency: 'EUR',
      });

      expect(result).toMatchObject({ objective: 'Retirement Updated' });
      const call = mockSend.mock.calls[0][0];
      expect(call._type).toBe('Update');
      expect(call.input.Key).toEqual({ pk: 'InvestorProfile#t1#u1', sk: 'InvestorProfile' });
      expect(call.input.ExpressionAttributeNames).toMatchObject({
        '#ts': 'timestamp',
        '#objective': 'objective',
        '#currency': 'currency',
      });
      expect(call.input.UpdateExpression).toContain('goal.#objective = :objective');
      expect(call.input.UpdateExpression).toContain('goal.#currency = :currency');
      expect(call.input.UpdateExpression).toContain('updatedAt = :now');
    });

    it('throws EntityNotFoundError when profile not found', async () => {
      mockSend.mockResolvedValueOnce({ Attributes: undefined });

      await expect(repo.updateGoal(ctx('t1', 'u1'), { objective: 'X' })).rejects.toThrow('not found');
    });
  });

  describe('grantMandate (composite row)', () => {
    it('updates mandate.<field> paths on the InvestorProfile row', async () => {
      const updatedAttrs = {
        pk: 'InvestorProfile#t1#u1',
        sk: 'InvestorProfile',
        mandate: {
          level: 'DISCRETIONARY',
          monthlyTurnoverCapPercent: 10,
          maxSingleTradePercent: 5,
          rebalanceCadence: 'MONTHLY',
        },
      };
      mockSend.mockResolvedValueOnce({ Attributes: updatedAttrs });

      const mandate = {
        level: 'DISCRETIONARY' as const,
        monthlyTurnoverCapPercent: 10,
        maxSingleTradePercent: 5,
        rebalanceCadence: 'MONTHLY' as const,
      };

      const result = await repo.grantMandate(ctx('t1', 'u1'), mandate);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call._type).toBe('Update');
      expect(call.input.Key).toEqual({ pk: 'InvestorProfile#t1#u1', sk: 'InvestorProfile' });
      expect(call.input.UpdateExpression).toContain('mandate.#level = :level');
      expect(call.input.UpdateExpression).toContain('mandate.#monthlyTurnoverCapPercent = :monthlyTurnoverCapPercent');
      expect(call.input.UpdateExpression).toContain('mandate.#maxSingleTradePercent = :maxSingleTradePercent');
      expect(call.input.UpdateExpression).toContain('mandate.#rebalanceCadence = :rebalanceCadence');
      expect(call.input.ConditionExpression).toBe('attribute_exists(pk)');
      expect(result).toMatchObject({ level: 'DISCRETIONARY' });
    });

    it('rejects monthlyTurnoverCapPercent > 100', async () => {
      await expect(
        repo.grantMandate(ctx('t1', 'u1'), {
          level: 'DISCRETIONARY',
          monthlyTurnoverCapPercent: 150,
          maxSingleTradePercent: 5,
          rebalanceCadence: 'MONTHLY',
        }),
      ).rejects.toThrow('monthlyTurnoverCapPercent must be between 0 and 100');
    });

    it('rejects negative monthlyTurnoverCapPercent', async () => {
      await expect(
        repo.grantMandate(ctx('t1', 'u1'), {
          level: 'DISCRETIONARY',
          monthlyTurnoverCapPercent: -1,
          maxSingleTradePercent: 5,
          rebalanceCadence: 'MONTHLY',
        }),
      ).rejects.toThrow('monthlyTurnoverCapPercent must be between 0 and 100');
    });

    it('rejects maxSingleTradePercent > 100', async () => {
      await expect(
        repo.grantMandate(ctx('t1', 'u1'), {
          level: 'DISCRETIONARY',
          monthlyTurnoverCapPercent: 10,
          maxSingleTradePercent: 200,
          rebalanceCadence: 'MONTHLY',
        }),
      ).rejects.toThrow('maxSingleTradePercent must be between 0 and 100');
    });

    it('throws EntityNotFoundError when profile not found', async () => {
      mockSend.mockResolvedValueOnce({ Attributes: undefined });

      await expect(
        repo.grantMandate(ctx('t1', 'u1'), {
          level: 'DISCRETIONARY',
          monthlyTurnoverCapPercent: 10,
          maxSingleTradePercent: 5,
          rebalanceCadence: 'MONTHLY',
        }),
      ).rejects.toThrow('not found');
    });
  });

  describe('setOperatingMode', () => {
    it('updates operatingMode without touching mandate fields', async () => {
      const send = jest.fn().mockResolvedValue({});
      const repo = new InvestorProfileRepository('test-table');
      (repo as any).docClient = { send };
      await repo.setOperatingMode({ tenantId: 't1', userId: 'u1', region: 'us-east-1' } as any, 'AGGRESSIVE');
      const cmd = send.mock.calls[0][0];
      expect(cmd.input.UpdateExpression).toMatch(/SET operatingMode = :mode/);
      expect(cmd.input.UpdateExpression).not.toMatch(/mandate\./);
    });
  });

  describe('revokeMandate (Mandate row)', () => {
    it('writes status=REVOKED + revokedAt to sk=Mandate, conditional on status=ACTIVE', async () => {
      const send = jest.fn().mockResolvedValue({});
      const repo = new InvestorProfileRepository('test-table');
      (repo as any).docClient = { send };
      await repo.revokeMandate({ tenantId: 't1', userId: 'u1', region: 'us-east-1' } as any);
      const cmd = send.mock.calls[0][0];
      expect(cmd.input.Key.sk).toBe('Mandate');
      expect(cmd.input.UpdateExpression).toMatch(/SET #status = :revoked/);
      expect(cmd.input.ConditionExpression).toMatch(/#status = :active/);
    });
  });

  describe('markNotificationRead', () => {
    it('should update notification status to READ', async () => {
      const updated = {
        notificationId: 'n1',
        status: 'READ',
        readAt: '2025-01-01T00:00:00.000Z',
      };
      mockSend.mockResolvedValueOnce({ Attributes: updated });

      const result = await repo.markNotificationRead('t1', 'u1', 'n1');

      expect(result).toMatchObject({ status: 'READ' });
    });

    it('should throw when notification not found', async () => {
      mockSend.mockResolvedValueOnce({ Attributes: undefined });

      await expect(repo.markNotificationRead('t1', 'u1', 'n1')).rejects.toThrow('not found');
    });
  });

  describe('getUnreadCount', () => {
    it('should return count of unread notifications', async () => {
      mockSend.mockResolvedValueOnce({ Count: 5 });

      const count = await repo.getUnreadCount('t1', 'u1');

      expect(count).toBe(5);
    });
  });

  describe('input validation', () => {
    describe('setGoal validation', () => {
      it('should reject negative targetAmountCents', async () => {
        await expect(
          repo.setGoal(ctx('t1', 'u1'), {
            objective: 'Retirement',
            targetAmountCents: -100,
            currency: 'USD',
            timeHorizonMonths: 120,
            targetReturn: 0.07,
          }),
        ).rejects.toThrow('targetAmountCents must be >= 0');
      });

      it('should reject zero timeHorizonMonths', async () => {
        await expect(
          repo.setGoal(ctx('t1', 'u1'), {
            objective: 'Retirement',
            targetAmountCents: 100000,
            currency: 'USD',
            timeHorizonMonths: 0,
            targetReturn: 0.07,
          }),
        ).rejects.toThrow('timeHorizonMonths must be > 0');
      });
    });

    describe('updateGoal validation', () => {
      it('should reject negative targetAmountCents in partial update', async () => {
        await expect(
          repo.updateGoal(ctx('t1', 'u1'), { targetAmountCents: -500 }),
        ).rejects.toThrow('targetAmountCents must be >= 0');
      });

      it('should reject zero timeHorizonMonths in partial update', async () => {
        await expect(
          repo.updateGoal(ctx('t1', 'u1'), { timeHorizonMonths: 0 }),
        ).rejects.toThrow('timeHorizonMonths must be > 0');
      });
    });
  });
});
