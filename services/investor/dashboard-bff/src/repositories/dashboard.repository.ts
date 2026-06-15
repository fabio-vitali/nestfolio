import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  GetCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { TableRepository, getTime, type TableEntry, type RequestContext } from '@nestfolio/event-processor';
import { withMethodLogging, guardedWrite } from '@nestfolio/event-processor';

function dashboardPk(tenantId: string): string {
  return `T#${tenantId}`;
}

export class DashboardRepository extends TableRepository {
  private readonly log = withMethodLogging('DashboardRepository');

  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

  // --- Portfolio Summary ---

  readonly upsertPortfolioSummary = this.log('upsertPortfolioSummary',
    async (
      tenantId: string,
      updates: {
        totalValueCents?: number;
        cashBalanceCents?: number;
        positionCount?: number;
        driftPercent?: number;
      },
    ): Promise<void> => {
      const pk = dashboardPk(tenantId);
      const now = getTime();

      const updateExpressions: string[] = [
        '#ts = :ts',
        'updatedAt = :now',
        '__typename = :typename',
        'tenantId = :tenantId',
      ];
      const expressionNames: Record<string, string> = { '#ts': 'timestamp' };
      const expressionValues: Record<string, unknown> = {
        ':ts': now,
        ':now': now,
        ':typename': 'PortfolioSummary',
        ':tenantId': tenantId,
      };

      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) {
          updateExpressions.push(`${key} = :${key}`);
          expressionValues[`:${key}`] = value;
        }
      }

      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk, sk: 'PortfolioSummary' },
          UpdateExpression: `SET ${updateExpressions.join(', ')}`,
          ExpressionAttributeNames: expressionNames,
          ExpressionAttributeValues: expressionValues,
        }),
      );
    },
  );

  readonly atomicIncrementTotalValue = this.log('atomicIncrementTotalValue',
    async (
      tenantId: string,
      deltaCents: number,
      extraUpdates?: Record<string, number>,
    ): Promise<void> => {
      const pk = dashboardPk(tenantId);
      const now = getTime();

      const updateExpressions: string[] = [
        '#ts = :ts',
        'updatedAt = :now',
        '__typename = :typename',
        'tenantId = :tenantId',
        'totalValueCents = if_not_exists(totalValueCents, :zero) + :delta',
      ];
      const expressionNames: Record<string, string> = { '#ts': 'timestamp' };
      const expressionValues: Record<string, unknown> = {
        ':ts': now,
        ':now': now,
        ':typename': 'PortfolioSummary',
        ':tenantId': tenantId,
        ':zero': 0,
        ':delta': deltaCents,
      };

      if (extraUpdates) {
        for (const [key, value] of Object.entries(extraUpdates)) {
          if (value !== undefined) {
            updateExpressions.push(`${key} = :${key}`);
            expressionValues[`:${key}`] = value;
          }
        }
      }

      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk, sk: 'PortfolioSummary' },
          UpdateExpression: `SET ${updateExpressions.join(', ')}`,
          ExpressionAttributeNames: expressionNames,
          ExpressionAttributeValues: expressionValues,
        }),
      );
    },
  );

  readonly guardedAtomicIncrementTotalValue = this.log('guardedAtomicIncrementTotalValue',
    async (
      tenantId: string,
      eventId: string,
      pipeName: string,
      deltaCents: number,
      extraUpdates?: Record<string, number>,
    ): Promise<boolean> => {
      const pk = dashboardPk(tenantId);
      const now = getTime();

      const updateExpressions: string[] = [
        '#ts = :ts',
        'updatedAt = :now',
        '__typename = :typename',
        'tenantId = :tenantId',
        'totalValueCents = if_not_exists(totalValueCents, :zero) + :delta',
      ];
      const expressionNames: Record<string, string> = { '#ts': 'timestamp' };
      const expressionValues: Record<string, unknown> = {
        ':ts': now,
        ':now': now,
        ':typename': 'PortfolioSummary',
        ':tenantId': tenantId,
        ':zero': 0,
        ':delta': deltaCents,
      };

      if (extraUpdates) {
        for (const [key, value] of Object.entries(extraUpdates)) {
          if (value !== undefined) {
            updateExpressions.push(`${key} = :${key}`);
            expressionValues[`:${key}`] = value;
          }
        }
      }

      return guardedWrite(
        this.docClient,
        this.tableName,
        { pk, sk: `ProcessedEvent#${eventId}#${pipeName}` },
        [
          {
            Update: {
              TableName: this.tableName,
              Key: { pk, sk: 'PortfolioSummary' },
              UpdateExpression: `SET ${updateExpressions.join(', ')}`,
              ExpressionAttributeNames: expressionNames,
              ExpressionAttributeValues: expressionValues,
            },
          },
        ],
      );
    },
  );

  readonly getPortfolioSummary = this.log('getPortfolioSummary',
    async (tenantId: string): Promise<Record<string, unknown> | null> => {
      const pk = dashboardPk(tenantId);
      const result = await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { pk, sk: 'PortfolioSummary' },
        }),
      );
      return (result.Item as Record<string, unknown>) ?? null;
    },
  );

  // --- Position Snapshots ---

  readonly getPositionSnapshots = this.log('getPositionSnapshots',
    async (tenantId: string): Promise<Record<string, unknown>[]> => {
      const pk = dashboardPk(tenantId);
      return this.queryByPk(pk, 'PositionSnapshot#');
    },
  );

  // --- Recent Activity ---

  readonly addActivity = this.log('addActivity',
    async (
      eventId: string,
      activity: {
        activityType: string;
        description: string;
        metadata?: Record<string, unknown>;
      },
      ctx: RequestContext,
    ): Promise<boolean> => {
      const pk = dashboardPk(ctx.tenantId);
      const now = getTime();

      const TTL_90_DAYS = 90 * 24 * 60 * 60;
      const expiresAt = Math.floor(Date.now() / 1000) + TTL_90_DAYS;

      const item: TableEntry = {
        pk,
        sk: `Activity#${now}#${eventId}`,
        __typename: 'RecentActivity',
        ...ctx,
        timestamp: now,
        sourceEventId: eventId,
        activityType: activity.activityType,
        description: activity.description,
        metadata: activity.metadata ? JSON.stringify(activity.metadata) : null,
        ttl: expiresAt,
      };

      return this.putIfNotExists(item);
    },
  );

  readonly getRecentActivity = this.log('getRecentActivity',
    async (tenantId: string, limit: number = 20): Promise<Record<string, unknown>[]> => {
      const pk = dashboardPk(tenantId);

      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
          ExpressionAttributeValues: { ':pk': pk, ':sk': 'Activity#' },
          ScanIndexForward: false,
          Limit: limit,
        }),
      );

      return (result.Items ?? []) as Record<string, unknown>[];
    },
  );

  // --- Investor Snapshot ---

  readonly upsertInvestorSnapshot = this.log('upsertInvestorSnapshot',
    async (
      tenantId: string,
      data: {
        goalType?: string;
        riskLevel?: string;
        operatingMode?: string;
        executionMode?: string;
        mandateLevel?: string;
        onboardedAt?: string;
      },
    ): Promise<void> => {
      const pk = dashboardPk(tenantId);
      const now = getTime();

      const updateExpressions: string[] = [
        '#ts = :ts',
        'updatedAt = :now',
        '__typename = :typename',
        'tenantId = :tenantId',
      ];
      const expressionNames: Record<string, string> = { '#ts': 'timestamp' };
      const expressionValues: Record<string, unknown> = {
        ':ts': now,
        ':now': now,
        ':typename': 'InvestorSnapshot',
        ':tenantId': tenantId,
      };

      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) {
          updateExpressions.push(`${key} = :${key}`);
          expressionValues[`:${key}`] = value;
        }
      }

      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk, sk: 'InvestorSnapshot' },
          UpdateExpression: `SET ${updateExpressions.join(', ')}`,
          ExpressionAttributeNames: expressionNames,
          ExpressionAttributeValues: expressionValues,
        }),
      );
    },
  );

  // --- Time-Travel Availability ---

  readonly upsertTimeTravelAvailability = this.log('upsertTimeTravelAvailability',
    async (tenantId: string, snapshotAt: string): Promise<void> => {
      const pk = dashboardPk(tenantId);
      const now = getTime();

      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk, sk: 'TimeTravelAvailability' },
          UpdateExpression: 'SET #ts = :ts, updatedAt = :now, __typename = :typename, tenantId = :tenantId, available = :available, latestDate = :latest, oldestDate = if_not_exists(oldestDate, :latest)',
          ExpressionAttributeNames: { '#ts': 'timestamp' },
          ExpressionAttributeValues: {
            ':ts': now,
            ':now': now,
            ':typename': 'TimeTravelAvailability',
            ':tenantId': tenantId,
            ':available': true,
            ':latest': snapshotAt.slice(0, 10),
          },
        }),
      );
    },
  );

  readonly getTimeTravelAvailability = this.log('getTimeTravelAvailability',
    async (tenantId: string): Promise<Record<string, unknown> | null> => {
      const pk = dashboardPk(tenantId);
      const result = await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { pk, sk: 'TimeTravelAvailability' },
        }),
      );
      return (result.Item as Record<string, unknown>) ?? null;
    },
  );

  // --- Aggregated Dashboard Query ---

  readonly getDashboard = this.log('getDashboard',
    async (tenantId: string): Promise<{
      portfolioSummary: Record<string, unknown> | null;
      advisoryStatus: Record<string, unknown> | null;
      investorSnapshot: Record<string, unknown> | null;
    }> => {
      const pk = dashboardPk(tenantId);

      const [portfolioResult, advisoryResult, investorResult] = await Promise.all([
        this.docClient.send(
          new GetCommand({ TableName: this.tableName, Key: { pk, sk: 'PortfolioSummary' } }),
        ),
        this.docClient.send(
          new GetCommand({ TableName: this.tableName, Key: { pk, sk: 'AdvisoryStatus' } }),
        ),
        this.docClient.send(
          new GetCommand({ TableName: this.tableName, Key: { pk, sk: 'InvestorSnapshot' } }),
        ),
      ]);

      return {
        portfolioSummary: (portfolioResult.Item as Record<string, unknown>) ?? null,
        advisoryStatus: (advisoryResult.Item as Record<string, unknown>) ?? null,
        investorSnapshot: (investorResult.Item as Record<string, unknown>) ?? null,
      };
    },
  );
}
