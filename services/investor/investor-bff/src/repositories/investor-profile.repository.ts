import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  GetCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { TableRepository, getUUID, getTime, NotRetryableError, type TableEntry } from '@nestfolio/event-processor';
import { withMethodLogging } from '@nestfolio/event-processor';
import { EntityNotFoundError } from '@nestfolio/event-processor';
import type {
  Goal,
  RiskProfile,
  Mandate,
  OperatingMode,
  ExecutionMode,
  MandateLevel,
  RebalanceCadence,
  Notification,
} from '../domain/models';

function profilePk(tenantId: string, userId: string): string {
  return `InvestorProfile#${tenantId}#${userId}`;
}

export class InvestorProfileRepository extends TableRepository {
  private readonly log = withMethodLogging('InvestorProfileRepository');

  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

  readonly createProfile = this.log('createProfile',
    async (tenantId: string, userId: string, email: string, sourceEventId: string): Promise<boolean> => {
      const now = getTime();
      const item: TableEntry = {
        pk: profilePk(tenantId, userId),
        sk: 'InvestorProfile',
        __typename: 'InvestorProfile',
        tenantId,
        timestamp: now,
        userId,
        name: '',
        email,
        age: 0,
        locale: 'en',
        operatingMode: 'BALANCED',
        executionMode: 'simulation',
        monthlyContributionCents: 0,
        currency: 'USD',
        onboardingCompletedAt: null,
        createdAt: now,
        updatedAt: now,
        sourceEventId,
      };
      return this.putIfNotExists(item);
    },
  );

  readonly getProfile = this.log('getProfile',
    async (tenantId: string, userId: string): Promise<Record<string, unknown>> => {
      const pk = profilePk(tenantId, userId);
      const result = await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { pk, sk: 'InvestorProfile' },
        }),
      );
      if (!result.Item) {
        throw new EntityNotFoundError('InvestorProfile', `${tenantId}#${userId}`);
      }
      return result.Item;
    },
  );

  readonly setGoal = this.log('setGoal',
    async (
      tenantId: string,
      userId: string,
      goal: {
        objective: string;
        targetAmountCents: number;
        currency: string;
        timeHorizonMonths: number;
        targetReturn: number;
      },
    ): Promise<Goal> => {
      validateGoalFields(goal);
      const pk = profilePk(tenantId, userId);
      const now = getTime();
      const goalId = getUUID();

      const goalItem: TableEntry = {
        pk,
        sk: `Goal#${goalId}`,
        __typename: 'Goal',
        tenantId,
        timestamp: now,
        goalId,
        objective: goal.objective,
        targetAmountCents: goal.targetAmountCents,
        currency: goal.currency,
        timeHorizonMonths: goal.timeHorizonMonths,
        targetReturn: goal.targetReturn,
        createdAt: now,
        updatedAt: now,
      };

      await this.put(goalItem);

      return goalItem as unknown as Goal;
    },
  );

  readonly updateGoal = this.log('updateGoal',
    async (
      tenantId: string,
      userId: string,
      goalId: string,
      updates: Partial<{
        objective: string;
        targetAmountCents: number;
        currency: string;
        timeHorizonMonths: number;
        targetReturn: number;
      }>,
    ): Promise<Goal> => {
      validateGoalFields(updates);
      const pk = profilePk(tenantId, userId);
      const now = getTime();

      const updateExpressions: string[] = ['#ts = :ts', '#updatedAt = :now'];
      const expressionNames: Record<string, string> = { '#ts': 'timestamp', '#updatedAt': 'updatedAt' };
      const expressionValues: Record<string, unknown> = { ':ts': now, ':now': now };

      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) {
          updateExpressions.push(`#${key} = :${key}`);
          expressionNames[`#${key}`] = key;
          expressionValues[`:${key}`] = value;
        }
      }

      const result = await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk, sk: `Goal#${goalId}` },
          UpdateExpression: `SET ${updateExpressions.join(', ')}`,
          ExpressionAttributeNames: expressionNames,
          ExpressionAttributeValues: expressionValues,
          ConditionExpression: 'attribute_exists(pk)',
          ReturnValues: 'ALL_NEW',
        }),
      );

      if (!result.Attributes) {
        throw new EntityNotFoundError('Goal', goalId);
      }

      return result.Attributes as unknown as Goal;
    },
  );

  readonly getGoals = this.log('getGoals',
    async (tenantId: string, userId: string): Promise<Goal[]> => {
      const pk = profilePk(tenantId, userId);
      const items = await this.queryByPk(pk, 'Goal#');
      return items as unknown as Goal[];
    },
  );

  readonly setRiskProfile = this.log('setRiskProfile',
    async (
      tenantId: string,
      userId: string,
      riskProfile: { score: number; band: { minEquity: number; maxEquity: number } },
    ): Promise<RiskProfile> => {
      const pk = profilePk(tenantId, userId);
      const now = getTime();
      const profileId = getUUID();

      const item: TableEntry = {
        pk,
        sk: 'RiskProfile',
        __typename: 'RiskProfile',
        tenantId,
        timestamp: now,
        profileId,
        score: riskProfile.score,
        band: riskProfile.band,
        assessedAt: now,
        version: 1,
      };

      await this.put(item);

      return item as unknown as RiskProfile;
    },
  );

  readonly grantMandate = this.log('grantMandate',
    async (
      tenantId: string,
      userId: string,
      mandate: {
        level: MandateLevel;
        monthlyTurnoverCapPercent: number;
        maxSingleTradePercent: number;
        coolDownDays: number;
        rebalanceCadence: RebalanceCadence;
      },
      editedBy?: string,
    ): Promise<Mandate> => {
      if (mandate.monthlyTurnoverCapPercent < 0 || mandate.monthlyTurnoverCapPercent > 100) {
        throw new NotRetryableError('monthlyTurnoverCapPercent must be between 0 and 100');
      }
      if (mandate.maxSingleTradePercent < 0 || mandate.maxSingleTradePercent > 100) {
        throw new NotRetryableError('maxSingleTradePercent must be between 0 and 100');
      }
      if (mandate.coolDownDays < 0) {
        throw new NotRetryableError('coolDownDays must be >= 0');
      }
      const pk = profilePk(tenantId, userId);
      const now = getTime();
      const mandateId = getUUID();

      const item: TableEntry = {
        pk,
        sk: 'Mandate',
        __typename: 'Mandate',
        tenantId,
        timestamp: now,
        mandateId,
        level: mandate.level,
        monthlyTurnoverCapPercent: mandate.monthlyTurnoverCapPercent,
        maxSingleTradePercent: mandate.maxSingleTradePercent,
        coolDownDays: mandate.coolDownDays,
        rebalanceCadence: mandate.rebalanceCadence,
        effectiveDate: now,
        revokedAt: null,
        version: 1,
      };

      await this.put(item);

      return item as unknown as Mandate;
    },
  );

  readonly revokeMandate = this.log('revokeMandate',
    async (tenantId: string, userId: string, editedBy?: string): Promise<Mandate> => {
      const pk = profilePk(tenantId, userId);
      const now = getTime();

      const result = await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk, sk: 'Mandate' },
          UpdateExpression: 'SET revokedAt = :revokedAt, #ts = :ts',
          ExpressionAttributeNames: { '#ts': 'timestamp' },
          ExpressionAttributeValues: { ':revokedAt': now, ':ts': now },
          ConditionExpression: 'attribute_exists(pk)',
          ReturnValues: 'ALL_NEW',
        }),
      );

      if (!result.Attributes) {
        throw new EntityNotFoundError('Mandate', `${tenantId}#${userId}`);
      }

      return result.Attributes as unknown as Mandate;
    },
  );

  readonly setOperatingMode = this.log('setOperatingMode',
    async (tenantId: string, userId: string, mode: OperatingMode): Promise<Record<string, unknown>> => {
      const pk = profilePk(tenantId, userId);
      const now = getTime();

      const item: TableEntry = {
        pk,
        sk: 'OperatingMode',
        __typename: 'OperatingModeRecord',
        tenantId,
        timestamp: now,
        mode,
        selectedAt: now,
      };

      await this.transactWrite({
        TransactItems: [
          { Put: { TableName: this.tableName, Item: item } },
          {
            Update: {
              TableName: this.tableName,
              Key: { pk, sk: 'InvestorProfile' },
              UpdateExpression: 'SET operatingMode = :mode, updatedAt = :now, #ts = :ts',
              ExpressionAttributeNames: { '#ts': 'timestamp' },
              ExpressionAttributeValues: { ':mode': mode, ':now': now, ':ts': now },
            },
          },
        ],
      });

      return item;
    },
  );

  readonly setExecutionMode = this.log('setExecutionMode',
    async (tenantId: string, userId: string, fromMode: ExecutionMode, toMode: ExecutionMode): Promise<Record<string, unknown>> => {
      const pk = profilePk(tenantId, userId);
      const now = getTime();
      const changeId = getUUID();

      const changeItem: TableEntry = {
        pk,
        sk: `ExecutionModeChange#${changeId}`,
        __typename: 'ExecutionModeChange',
        tenantId,
        timestamp: now,
        changeId,
        fromMode,
        toMode,
        changedAt: now,
      };

      await this.transactWrite({
        TransactItems: [
          { Put: { TableName: this.tableName, Item: changeItem } },
          {
            Update: {
              TableName: this.tableName,
              Key: { pk, sk: 'InvestorProfile' },
              UpdateExpression: 'SET executionMode = :mode, updatedAt = :now, #ts = :ts',
              ExpressionAttributeNames: { '#ts': 'timestamp' },
              ExpressionAttributeValues: { ':mode': toMode, ':now': now, ':ts': now },
            },
          },
        ],
      });

      return changeItem;
    },
  );

  readonly upsertReadOnlyBalance = this.log('upsertReadOnlyBalance',
    async (tenantId: string, userId: string, balanceCents: number): Promise<void> => {
      const pk = profilePk(tenantId, userId);
      const now = getTime();
      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk, sk: 'CashBalance' },
          UpdateExpression: 'SET balanceCents = :balance, #ts = :ts, updatedAt = :now, #tn = :tn, pk = if_not_exists(pk, :pk), tenantId = if_not_exists(tenantId, :tid)',
          ExpressionAttributeNames: { '#ts': 'timestamp', '#tn': '__typename' },
          ExpressionAttributeValues: { ':balance': balanceCents, ':ts': now, ':now': now, ':tn': 'CashBalance', ':pk': pk, ':tid': tenantId },
        }),
      );
    },
  );

  readonly addNotification = this.log('addNotification',
    async (
      tenantId: string,
      userId: string,
      notification: {
        notificationId: string;
        channel: string;
        title: string;
        body: string;
        relatedEntityType: string;
        relatedEntityId: string;
      },
      sourceEventId: string,
    ): Promise<boolean> => {
      const pk = profilePk(tenantId, userId);
      const now = getTime();

      const item: TableEntry = {
        pk,
        sk: `Notification#${notification.notificationId}`,
        __typename: 'Notification',
        tenantId,
        timestamp: now,
        notificationId: notification.notificationId,
        channel: notification.channel,
        title: notification.title,
        body: notification.body,
        status: 'CREATED',
        relatedEntityType: notification.relatedEntityType,
        relatedEntityId: notification.relatedEntityId,
        createdAt: now,
        sentAt: null,
        deliveredAt: null,
        readAt: null,
        sourceEventId,
      };

      return this.putIfNotExists(item);
    },
  );

  readonly getNotifications = this.log('getNotifications',
    async (
      tenantId: string,
      userId: string,
      limit: number = 20,
      cursor?: string,
    ): Promise<{ items: Notification[]; nextCursor: string | null }> => {
      const pk = profilePk(tenantId, userId);

      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
          ExpressionAttributeValues: { ':pk': pk, ':sk': 'Notification#' },
          ScanIndexForward: false,
          Limit: limit,
          ...(cursor
            ? { ExclusiveStartKey: JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8')) }
            : {}),
        }),
      );

      const nextCursor = result.LastEvaluatedKey
        ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
        : null;

      return {
        items: (result.Items ?? []) as unknown as Notification[],
        nextCursor,
      };
    },
  );

  readonly markNotificationRead = this.log('markNotificationRead',
    async (tenantId: string, userId: string, notificationId: string): Promise<Notification> => {
      const pk = profilePk(tenantId, userId);
      const now = getTime();

      const result = await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk, sk: `Notification#${notificationId}` },
          UpdateExpression: 'SET #status = :status, readAt = :readAt, #ts = :ts',
          ExpressionAttributeNames: { '#status': 'status', '#ts': 'timestamp' },
          ExpressionAttributeValues: { ':status': 'READ', ':readAt': now, ':ts': now },
          ConditionExpression: 'attribute_exists(pk)',
          ReturnValues: 'ALL_NEW',
        }),
      );

      if (!result.Attributes) {
        throw new EntityNotFoundError('Notification', notificationId);
      }

      return result.Attributes as unknown as Notification;
    },
  );

  readonly getUnreadCount = this.log('getUnreadCount',
    async (tenantId: string, userId: string): Promise<number> => {
      const pk = profilePk(tenantId, userId);

      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
          FilterExpression: '#status <> :read',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':pk': pk, ':sk': 'Notification#', ':read': 'READ' },
          Select: 'COUNT',
        }),
      );

      return result.Count ?? 0;
    },
  );
}

/**
 * Validates goal fields before DynamoDB writes.
 * Accepts partial updates (only validates provided fields).
 */
function validateGoalFields(
  fields: Partial<{
    targetAmountCents: number;
    timeHorizonMonths: number;
    targetReturn: number;
  }>,
): void {
  if (fields.targetAmountCents !== undefined && fields.targetAmountCents < 0) {
    throw new NotRetryableError('targetAmountCents must be >= 0');
  }
  if (fields.timeHorizonMonths !== undefined && fields.timeHorizonMonths <= 0) {
    throw new NotRetryableError('timeHorizonMonths must be > 0');
  }
  if (fields.targetReturn !== undefined && (fields.targetReturn < -1 || fields.targetReturn > 1)) {
    throw new NotRetryableError('targetReturn must be between -1 and 1');
  }
}
