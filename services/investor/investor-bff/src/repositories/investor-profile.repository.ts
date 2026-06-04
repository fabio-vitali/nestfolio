import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { TableRepository, getTime, type TableEntry, type RequestContext } from '@nestfolio/event-processor';
import { withMethodLogging } from '@nestfolio/event-processor';
import { EntityNotFoundError } from '@nestfolio/event-processor';
import type {
  ExecutionMode,
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
