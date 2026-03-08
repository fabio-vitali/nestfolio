import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  GetCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { TableRepository, getUUID, getTime, log, NotRetryableError, type TableEntry } from '@nestfolio/platform-core';
import { EntityNotFoundError } from '@nestfolio/domain-core';
import type {
  Goal,
  RiskProfile,
  Mandate,
  OperatingMode,
  MandateLevel,
  RebalanceCadence,
  Notification,
} from '@nestfolio/domain-core';

function profilePk(tenantId: string, userId: string): string {
  return `InvestorProfile#${tenantId}#${userId}`;
}

export class InvestorProfileRepository extends TableRepository {
  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

  @log()
  async createProfile(tenantId: string, userId: string, email: string): Promise<void> {
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
      monthlyContributionCents: 0,
      currency: 'USD',
      onboardingCompletedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.put(item);
  }

  @log()
  async getProfile(tenantId: string, userId: string): Promise<Record<string, unknown>> {
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
  }

  @log()
  async setGoal(
    tenantId: string,
    userId: string,
    goal: {
      objective: string;
      targetAmountCents: number;
      currency: string;
      timeHorizonMonths: number;
      targetReturn: number;
    },
  ): Promise<Goal> {
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

    const editEvent: TableEntry = {
      pk,
      sk: `EditEvent#${now}#${getUUID()}`,
      __typename: 'EditEvent',
      tenantId,
      timestamp: now,
      operation: 'add',
      path: `/goals/${goalId}`,
      value: goal,
      editedBy: userId,
      editedAt: now,
    };

    await this.transactWrite({
      TransactItems: [
        { Put: { TableName: this.tableName, Item: goalItem } },
        { Put: { TableName: this.tableName, Item: editEvent } },
      ],
    });

    return goalItem as unknown as Goal;
  }

  @log()
  async updateGoal(
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
  ): Promise<Goal> {
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

    const editEvent: TableEntry = {
      pk,
      sk: `EditEvent#${now}#${getUUID()}`,
      __typename: 'EditEvent',
      tenantId,
      timestamp: now,
      operation: 'replace',
      path: `/goals/${goalId}`,
      value: updates,
      editedBy: userId,
      editedAt: now,
    };
    await this.put(editEvent);

    return result.Attributes as unknown as Goal;
  }

  @log()
  async getGoals(tenantId: string, userId: string): Promise<Goal[]> {
    const pk = profilePk(tenantId, userId);
    const items = await this.queryByPk(pk, 'Goal#');
    return items as unknown as Goal[];
  }

  @log()
  async setRiskProfile(
    tenantId: string,
    userId: string,
    riskProfile: { score: number; band: { minEquity: number; maxEquity: number } },
  ): Promise<RiskProfile> {
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

    const editEvent: TableEntry = {
      pk,
      sk: `EditEvent#${now}#${getUUID()}`,
      __typename: 'EditEvent',
      tenantId,
      timestamp: now,
      operation: 'add',
      path: '/riskProfile',
      value: riskProfile,
      editedBy: userId,
      editedAt: now,
    };

    await this.transactWrite({
      TransactItems: [
        { Put: { TableName: this.tableName, Item: item } },
        { Put: { TableName: this.tableName, Item: editEvent } },
      ],
    });

    return item as unknown as RiskProfile;
  }

  @log()
  async grantMandate(
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
  ): Promise<Mandate> {
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

    const editEvent: TableEntry = {
      pk,
      sk: `EditEvent#${now}#${getUUID()}`,
      __typename: 'EditEvent',
      tenantId,
      timestamp: now,
      operation: 'add',
      path: '/mandate',
      value: mandate,
      editedBy: editedBy ?? userId,
      editedAt: now,
      action: 'GRANT_MANDATE',
    };

    await this.transactWrite({
      TransactItems: [
        { Put: { TableName: this.tableName, Item: item } },
        { Put: { TableName: this.tableName, Item: editEvent } },
      ],
    });

    return item as unknown as Mandate;
  }

  @log()
  async revokeMandate(tenantId: string, userId: string, editedBy?: string): Promise<Mandate> {
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

    const editEvent: TableEntry = {
      pk,
      sk: `EditEvent#${now}#${getUUID()}`,
      __typename: 'EditEvent',
      tenantId,
      timestamp: now,
      operation: 'replace',
      path: '/mandate/revokedAt',
      value: now,
      editedBy: editedBy ?? userId,
      editedAt: now,
      action: 'REVOKE_MANDATE',
    };
    await this.put(editEvent);

    return result.Attributes as unknown as Mandate;
  }

  @log()
  async setOperatingMode(tenantId: string, userId: string, mode: OperatingMode): Promise<Record<string, unknown>> {
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

    const editEvent: TableEntry = {
      pk,
      sk: `EditEvent#${now}#${getUUID()}`,
      __typename: 'EditEvent',
      tenantId,
      timestamp: now,
      operation: 'replace',
      path: '/operatingMode',
      value: mode,
      editedBy: userId,
      editedAt: now,
    };

    await this.transactWrite({
      TransactItems: [
        { Put: { TableName: this.tableName, Item: item } },
        { Put: { TableName: this.tableName, Item: editEvent } },
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
  }

  @log()
  async addNotification(
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
  ): Promise<void> {
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
    };

    await this.put(item);
  }

  @log()
  async getNotifications(
    tenantId: string,
    userId: string,
    limit: number = 20,
    cursor?: string,
  ): Promise<{ items: Notification[]; nextCursor: string | null }> {
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
  }

  @log()
  async markNotificationRead(tenantId: string, userId: string, notificationId: string): Promise<Notification> {
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
  }

  @log()
  async getUnreadCount(tenantId: string, userId: string): Promise<number> {
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
  }
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
