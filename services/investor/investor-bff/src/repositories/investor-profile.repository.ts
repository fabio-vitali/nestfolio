import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { TableRepository, getTime, NotRetryableError, type TableEntry, type RequestContext } from '@nestfolio/event-processor';
import { withMethodLogging } from '@nestfolio/event-processor';
import { EntityNotFoundError } from '@nestfolio/event-processor';
import type {
  Goal,
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

  readonly getProfile = this.log('getProfile',
    async (
      tenantId: string,
      userId: string,
    ): Promise<{ profile: Record<string, unknown>; mandateStatus: Record<string, unknown> | null }> => {
      const pk = profilePk(tenantId, userId);
      const result = await this.docClient.send(
        new BatchGetCommand({
          RequestItems: {
            [this.tableName]: {
              Keys: [
                { pk, sk: 'InvestorProfile' },
                { pk, sk: 'MandateStatus' },
              ],
            },
          },
        }),
      );
      const items = result.Responses?.[this.tableName] ?? [];
      const profile = items.find((i) => i.sk === 'InvestorProfile');
      const mandateStatus = items.find((i) => i.sk === 'MandateStatus') ?? null;
      if (!profile) {
        throw new EntityNotFoundError('InvestorProfile', `${tenantId}#${userId}`);
      }
      return { profile, mandateStatus };
    },
  );

  readonly setGoal = this.log('setGoal',
    async (
      ctx: RequestContext,
      goal: {
        objective: string;
        targetAmountCents: number;
        currency: string;
        timeHorizonMonths: number;
        targetReturn: number;
      },
    ): Promise<Goal> => {
      validateGoalFields(goal);
      const pk = profilePk(ctx.tenantId, ctx.userId);
      const now = getTime();

      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk, sk: 'InvestorProfile' },
          UpdateExpression: 'SET goal = :goal, updatedAt = :now, #ts = :ts',
          ExpressionAttributeNames: { '#ts': 'timestamp' },
          ExpressionAttributeValues: { ':goal': goal, ':now': now, ':ts': now },
          ConditionExpression: 'attribute_exists(pk)',
        }),
      );

      return goal as unknown as Goal;
    },
  );

  readonly updateGoal = this.log('updateGoal',
    async (
      ctx: RequestContext,
      updates: Partial<{
        objective: string;
        targetAmountCents: number;
        currency: string;
        timeHorizonMonths: number;
        targetReturn: number;
      }>,
    ): Promise<Goal> => {
      validateGoalFields(updates);
      const pk = profilePk(ctx.tenantId, ctx.userId);
      const now = getTime();

      const setExprs: string[] = ['updatedAt = :now', '#ts = :ts'];
      const exprNames: Record<string, string> = { '#ts': 'timestamp' };
      const exprValues: Record<string, unknown> = { ':now': now, ':ts': now };
      for (const [k, v] of Object.entries(updates)) {
        if (v === undefined) continue;
        setExprs.push(`goal.#${k} = :${k}`);
        exprNames[`#${k}`] = k;
        exprValues[`:${k}`] = v;
      }

      const result = await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk, sk: 'InvestorProfile' },
          UpdateExpression: `SET ${setExprs.join(', ')}`,
          ExpressionAttributeNames: exprNames,
          ExpressionAttributeValues: exprValues,
          ConditionExpression: 'attribute_exists(pk)',
          ReturnValues: 'ALL_NEW',
        }),
      );

      if (!result.Attributes) {
        throw new EntityNotFoundError('Goal', `${ctx.tenantId}#${ctx.userId}`);
      }

      return result.Attributes.goal as unknown as Goal;
    },
  );

  readonly grantMandate = this.log('grantMandate',
    async (
      ctx: RequestContext,
      mandate: {
        level: MandateLevel;
        monthlyTurnoverCapPercent: number;
        maxSingleTradePercent: number;
        rebalanceCadence: RebalanceCadence;
      },
    ): Promise<Mandate> => {
      if (mandate.monthlyTurnoverCapPercent < 0 || mandate.monthlyTurnoverCapPercent > 100) {
        throw new NotRetryableError('monthlyTurnoverCapPercent must be between 0 and 100');
      }
      if (mandate.maxSingleTradePercent < 0 || mandate.maxSingleTradePercent > 100) {
        throw new NotRetryableError('maxSingleTradePercent must be between 0 and 100');
      }
      const pk = profilePk(ctx.tenantId, ctx.userId);
      const now = getTime();

      const setExprs: string[] = ['updatedAt = :now', '#ts = :ts'];
      const exprNames: Record<string, string> = { '#ts': 'timestamp' };
      const exprValues: Record<string, unknown> = { ':now': now, ':ts': now };
      for (const [k, v] of Object.entries(mandate)) {
        setExprs.push(`mandate.#${k} = :${k}`);
        exprNames[`#${k}`] = k;
        exprValues[`:${k}`] = v;
      }

      const result = await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk, sk: 'InvestorProfile' },
          UpdateExpression: `SET ${setExprs.join(', ')}`,
          ExpressionAttributeNames: exprNames,
          ExpressionAttributeValues: exprValues,
          ConditionExpression: 'attribute_exists(pk)',
          ReturnValues: 'ALL_NEW',
        }),
      );

      if (!result.Attributes) {
        throw new EntityNotFoundError('Mandate', `${ctx.tenantId}#${ctx.userId}`);
      }

      return result.Attributes.mandate as unknown as Mandate;
    },
  );

  readonly setOperatingMode = this.log('setOperatingMode',
    async (ctx: RequestContext, mode: OperatingMode): Promise<{ mode: OperatingMode }> => {
      const pk = profilePk(ctx.tenantId, ctx.userId);
      const now = getTime();

      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk, sk: 'InvestorProfile' },
          UpdateExpression: 'SET operatingMode = :mode, updatedAt = :now, #ts = :ts',
          ExpressionAttributeNames: { '#ts': 'timestamp' },
          ExpressionAttributeValues: { ':mode': mode, ':now': now, ':ts': now },
          ConditionExpression: 'attribute_exists(pk)',
        }),
      );

      return { mode };
    },
  );

  readonly revokeMandate = this.log('revokeMandate',
    async (ctx: RequestContext): Promise<{ status: 'REVOKED'; revokedAt: string }> => {
      const pk = profilePk(ctx.tenantId, ctx.userId);
      const now = getTime();
      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk, sk: 'Mandate' },
          UpdateExpression:
            'SET #status = :revoked, revokedAt = :now, updatedAt = :now, #ts = :now',
          ExpressionAttributeNames: { '#status': 'status', '#ts': 'timestamp' },
          ExpressionAttributeValues: { ':revoked': 'REVOKED', ':now': now, ':active': 'ACTIVE' },
          ConditionExpression: '#status = :active',
        }),
      );
      return { status: 'REVOKED', revokedAt: now };
    },
  );

  readonly setExecutionMode = this.log('setExecutionMode',
    async (ctx: RequestContext, fromMode: ExecutionMode, toMode: ExecutionMode): Promise<Record<string, unknown>> => {
      const pk = profilePk(ctx.tenantId, ctx.userId);
      const now = getTime();
      const changeId = `${ctx.tenantId}#${ctx.userId}#${now}`;

      const changeItem: TableEntry = {
        pk,
        sk: `ExecutionModeChange#${changeId}`,
        __typename: 'ExecutionModeChange',
        ...ctx,
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
              UpdateExpression:
                'SET executionMode = :mode, updatedAt = :now, #ts = :ts, #v = if_not_exists(#v, :zero) + :one',
              ExpressionAttributeNames: { '#ts': 'timestamp', '#v': '__version' },
              ExpressionAttributeValues: { ':mode': toMode, ':now': now, ':ts': now, ':zero': 0, ':one': 1 },
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
      ctx: RequestContext,
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
      const pk = profilePk(ctx.tenantId, ctx.userId);
      const now = getTime();

      const item: TableEntry = {
        pk,
        sk: `Notification#${notification.notificationId}`,
        __typename: 'Notification',
        ...ctx,
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
