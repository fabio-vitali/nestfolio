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
  },
  getUUID: jest.fn().mockReturnValue('test-uuid'),
  getTime: jest.fn().mockReturnValue('2025-01-01T00:00:00.000Z'),
  log: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  NotRetryableError: class NotRetryableError extends Error {
    constructor(message: string, public readonly details?: Record<string, unknown>) {
      super(message);
      this.name = 'NotRetryableError';
    }
  },
}));

jest.mock('@nestfolio/domain-core', () => ({
  EntityNotFoundError: class EntityNotFoundError extends Error {
    constructor(public entityType: string, public entityId: string) {
      super(`${entityType} with id '${entityId}' not found`);
      this.name = 'EntityNotFoundError';
    }
  },
}));

import { InvestorProfileRepository } from './investor-profile.repository';

describe('InvestorProfileRepository', () => {
  let repo: InvestorProfileRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new InvestorProfileRepository('test-table');
  });

  describe('createProfile', () => {
    it('should create an InvestorProfile with defaults', async () => {
      mockSend.mockResolvedValueOnce({});

      await repo.createProfile('tenant-1', 'user-1', 'test@example.com');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.Item).toMatchObject({
        pk: 'InvestorProfile#tenant-1#user-1',
        sk: 'InvestorProfile',
        __typename: 'InvestorProfile',
        tenantId: 'tenant-1',
        email: 'test@example.com',
        operatingMode: 'BALANCED',
        currency: 'USD',
      });
    });
  });

  describe('getProfile', () => {
    it('should return profile when found', async () => {
      const profile = {
        pk: 'InvestorProfile#t1#u1',
        sk: 'InvestorProfile',
        __typename: 'InvestorProfile',
        tenantId: 't1',
        email: 'test@example.com',
      };
      mockSend.mockResolvedValueOnce({ Item: profile });

      const result = await repo.getProfile('t1', 'u1');

      expect(result).toEqual(profile);
    });

    it('should throw EntityNotFoundError when not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      await expect(repo.getProfile('t1', 'u1')).rejects.toThrow('not found');
    });
  });

  describe('setGoal', () => {
    it('should create goal and edit event in transaction', async () => {
      mockSend.mockResolvedValueOnce({});

      const goal = {
        objective: 'Retirement',
        targetAmountCents: 100000000,
        currency: 'USD',
        timeHorizonMonths: 360,
        targetReturn: 0.07,
      };

      const result = await repo.setGoal('t1', 'u1', goal);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.TransactItems).toHaveLength(2);
      expect(call.input.TransactItems[0].Put.Item).toMatchObject({
        pk: 'InvestorProfile#t1#u1',
        sk: 'Goal#test-uuid',
        __typename: 'Goal',
        objective: 'Retirement',
      });
      expect(call.input.TransactItems[1].Put.Item).toMatchObject({
        __typename: 'EditEvent',
        operation: 'add',
      });
      expect(result).toMatchObject({ goalId: 'test-uuid', objective: 'Retirement' });
    });
  });

  describe('getGoals', () => {
    it('should query all goals for a profile', async () => {
      const goals = [
        { goalId: 'g1', objective: 'Retirement' },
        { goalId: 'g2', objective: 'House' },
      ];
      mockSend.mockResolvedValueOnce({ Items: goals });

      const result = await repo.getGoals('t1', 'u1');

      expect(result).toEqual(goals);
    });
  });

  describe('updateGoal', () => {
    it('should use ExpressionAttributeNames for all dynamic fields', async () => {
      const updatedGoal = {
        pk: 'InvestorProfile#t1#u1',
        sk: 'Goal#g1',
        __typename: 'Goal',
        objective: 'Retirement Updated',
        currency: 'EUR',
      };
      // UpdateCommand returns attributes, then put for edit event
      mockSend.mockResolvedValueOnce({ Attributes: updatedGoal });
      mockSend.mockResolvedValueOnce({});

      const result = await repo.updateGoal('t1', 'u1', 'g1', {
        objective: 'Retirement Updated',
        currency: 'EUR',
      });

      expect(result).toMatchObject({ objective: 'Retirement Updated' });
      const call = mockSend.mock.calls[0][0];
      // All attribute names should be aliased with #
      expect(call.input.ExpressionAttributeNames).toMatchObject({
        '#ts': 'timestamp',
        '#updatedAt': 'updatedAt',
        '#objective': 'objective',
        '#currency': 'currency',
      });
      expect(call.input.UpdateExpression).toContain('#objective = :objective');
      expect(call.input.UpdateExpression).toContain('#currency = :currency');
      expect(call.input.UpdateExpression).toContain('#updatedAt = :now');
    });

    it('should throw EntityNotFoundError when goal not found', async () => {
      mockSend.mockResolvedValueOnce({ Attributes: undefined });

      await expect(repo.updateGoal('t1', 'u1', 'g1', { objective: 'X' })).rejects.toThrow('not found');
    });
  });

  describe('grantMandate', () => {
    it('should create mandate and edit event in transaction', async () => {
      mockSend.mockResolvedValueOnce({});

      const mandate = {
        level: 'DISCRETIONARY' as const,
        monthlyTurnoverCapPercent: 10,
        maxSingleTradePercent: 5,
        coolDownDays: 7,
        rebalanceCadence: 'MONTHLY' as const,
      };

      const result = await repo.grantMandate('t1', 'u1', mandate);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.TransactItems).toHaveLength(2);
      expect(call.input.TransactItems[0].Put.Item).toMatchObject({
        __typename: 'Mandate',
        level: 'DISCRETIONARY',
      });
      expect(result).toMatchObject({ mandateId: 'test-uuid', level: 'DISCRETIONARY' });
    });

    it('should record editedBy in the EditEvent when granting mandate', async () => {
      mockSend.mockResolvedValueOnce({});

      const mandate = {
        level: 'DISCRETIONARY' as const,
        monthlyTurnoverCapPercent: 10,
        maxSingleTradePercent: 5,
        coolDownDays: 7,
        rebalanceCadence: 'MONTHLY' as const,
      };

      await repo.grantMandate('t1', 'u1', mandate, 'admin-user');

      const call = mockSend.mock.calls[0][0];
      const editEvent = call.input.TransactItems[1].Put.Item;
      expect(editEvent).toMatchObject({
        __typename: 'EditEvent',
        editedBy: 'admin-user',
        action: 'GRANT_MANDATE',
      });
      expect(editEvent.editedAt).toBeDefined();
    });
  });

  describe('revokeMandate', () => {
    it('should set revokedAt on mandate', async () => {
      const updatedMandate = {
        pk: 'InvestorProfile#t1#u1',
        sk: 'Mandate',
        __typename: 'Mandate',
        revokedAt: '2025-01-01T00:00:00.000Z',
      };
      // UpdateCommand returns attributes, then put for edit event
      mockSend.mockResolvedValueOnce({ Attributes: updatedMandate });
      mockSend.mockResolvedValueOnce({});

      const result = await repo.revokeMandate('t1', 'u1');

      expect(result).toMatchObject({ revokedAt: '2025-01-01T00:00:00.000Z' });
    });

    it('should record editedBy in the EditEvent when revoking mandate', async () => {
      const updatedMandate = {
        pk: 'InvestorProfile#t1#u1',
        sk: 'Mandate',
        __typename: 'Mandate',
        revokedAt: '2025-01-01T00:00:00.000Z',
      };
      mockSend.mockResolvedValueOnce({ Attributes: updatedMandate });
      mockSend.mockResolvedValueOnce({});

      await repo.revokeMandate('t1', 'u1', 'admin-user');

      // Second call is the put for the EditEvent
      const editEventCall = mockSend.mock.calls[1][0];
      expect(editEventCall.input.Item).toMatchObject({
        __typename: 'EditEvent',
        editedBy: 'admin-user',
        action: 'REVOKE_MANDATE',
      });
      expect(editEventCall.input.Item.editedAt).toBeDefined();
    });
  });

  describe('setOperatingMode', () => {
    it('should merge profile update into single transaction with 3 items', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await repo.setOperatingMode('t1', 'u1', 'AGGRESSIVE' as any);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.TransactItems).toHaveLength(3);
      // Item 0: OperatingMode record
      expect(call.input.TransactItems[0].Put.Item).toMatchObject({
        __typename: 'OperatingModeRecord',
        mode: 'AGGRESSIVE',
      });
      // Item 1: EditEvent
      expect(call.input.TransactItems[1].Put.Item).toMatchObject({
        __typename: 'EditEvent',
        operation: 'replace',
      });
      // Item 2: Update InvestorProfile
      expect(call.input.TransactItems[2].Update).toMatchObject({
        Key: { pk: 'InvestorProfile#t1#u1', sk: 'InvestorProfile' },
      });
      expect(call.input.TransactItems[2].Update.ExpressionAttributeValues[':mode']).toBe('AGGRESSIVE');
      expect(result).toMatchObject({ mode: 'AGGRESSIVE' });
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
          repo.setGoal('t1', 'u1', {
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
          repo.setGoal('t1', 'u1', {
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
          repo.updateGoal('t1', 'u1', 'g1', { targetAmountCents: -500 }),
        ).rejects.toThrow('targetAmountCents must be >= 0');
      });

      it('should reject zero timeHorizonMonths in partial update', async () => {
        await expect(
          repo.updateGoal('t1', 'u1', 'g1', { timeHorizonMonths: 0 }),
        ).rejects.toThrow('timeHorizonMonths must be > 0');
      });
    });
  });
});
