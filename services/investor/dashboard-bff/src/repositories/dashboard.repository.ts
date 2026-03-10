import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  GetCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { TableRepository, getUUID, getTime, type TableEntry } from '@nestfolio/platform-core';
import { withMethodLogging } from '@nestfolio/lambda-utils';

function dashboardPk(tenantId: string): string {
  return `Dashboard#${tenantId}`;
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

  readonly upsertPositionSnapshot = this.log('upsertPositionSnapshot',
    async (
      tenantId: string,
      data: {
        symbol: string;
        assetClass?: string;
        quantity: number;
        avgCostBasisCents: number;
        currentPriceCents: number;
        marketValueCents: number;
        weightPercent: number;
        unrealizedPnlCents: number;
      },
    ): Promise<void> => {
      const pk = dashboardPk(tenantId);
      const now = getTime();

      const item: TableEntry = {
        pk,
        sk: `Position#${data.symbol}`,
        __typename: 'PositionSnapshot',
        tenantId,
        timestamp: now,
        symbol: data.symbol,
        assetClass: data.assetClass ?? 'EQUITY',
        quantity: data.quantity,
        avgCostBasisCents: data.avgCostBasisCents,
        currentPriceCents: data.currentPriceCents,
        marketValueCents: data.marketValueCents,
        weightPercent: data.weightPercent,
        unrealizedPnlCents: data.unrealizedPnlCents,
        lastUpdatedAt: now,
      };

      await this.put(item);
    },
  );

  readonly getPositionSnapshots = this.log('getPositionSnapshots',
    async (tenantId: string): Promise<Record<string, unknown>[]> => {
      const pk = dashboardPk(tenantId);
      return this.queryByPk(pk, 'Position#');
    },
  );

  // --- Recent Activity ---

  readonly addActivity = this.log('addActivity',
    async (
      tenantId: string,
      activity: {
        activityType: string;
        description: string;
        metadata?: Record<string, unknown>;
      },
    ): Promise<void> => {
      const pk = dashboardPk(tenantId);
      const now = getTime();
      const uuid = getUUID();

      const TTL_90_DAYS = 90 * 24 * 60 * 60;
      const expiresAt = Math.floor(Date.now() / 1000) + TTL_90_DAYS;

      const item: TableEntry = {
        pk,
        sk: `Activity#${now}#${uuid}`,
        __typename: 'RecentActivity',
        tenantId,
        timestamp: now,
        activityType: activity.activityType,
        description: activity.description,
        metadata: activity.metadata ? JSON.stringify(activity.metadata) : null,
        ttl: expiresAt,
      };

      await this.put(item);
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

  // --- Advisory Status ---

  readonly upsertAdvisoryStatus = this.log('upsertAdvisoryStatus',
    async (
      tenantId: string,
      updates: {
        pendingDecisionsCount?: number;
        pendingDecisionsDelta?: number;
        lastRecommendationAt?: string;
        lastDecisionStatus?: string;
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
        ':typename': 'AdvisoryStatus',
        ':tenantId': tenantId,
      };

      if (updates.pendingDecisionsDelta !== undefined) {
        updateExpressions.push('pendingDecisionsCount = if_not_exists(pendingDecisionsCount, :zero) + :delta');
        expressionValues[':delta'] = updates.pendingDecisionsDelta;
        expressionValues[':zero'] = 0;
      } else if (updates.pendingDecisionsCount !== undefined) {
        updateExpressions.push('pendingDecisionsCount = :pendingDecisionsCount');
        expressionValues[':pendingDecisionsCount'] = updates.pendingDecisionsCount;
      }

      if (updates.lastRecommendationAt !== undefined) {
        updateExpressions.push('lastRecommendationAt = :lastRecommendationAt');
        expressionValues[':lastRecommendationAt'] = updates.lastRecommendationAt;
      }

      if (updates.lastDecisionStatus !== undefined) {
        updateExpressions.push('lastDecisionStatus = :lastDecisionStatus');
        expressionValues[':lastDecisionStatus'] = updates.lastDecisionStatus;
      }

      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk, sk: 'AdvisoryStatus' },
          UpdateExpression: `SET ${updateExpressions.join(', ')}`,
          ExpressionAttributeNames: expressionNames,
          ExpressionAttributeValues: expressionValues,
        }),
      );
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
          Key: { pk, sk: 'TimeTravel' },
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
          Key: { pk, sk: 'TimeTravel' },
        }),
      );
      return (result.Item as Record<string, unknown>) ?? null;
    },
  );

  // --- Simulation Summary ---

  readonly upsertStreamSnapshot = this.log('upsertStreamSnapshot',
    async (
      tenantId: string,
      streamType: string,
      data: {
        totalValueCents: number;
        cashBalanceCents: number;
        positionCount: number;
      },
    ): Promise<void> => {
      const pk = dashboardPk(tenantId);
      const now = getTime();

      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk, sk: `StreamSnapshot#${streamType}` },
          UpdateExpression: 'SET #ts = :ts, updatedAt = :now, __typename = :typename, tenantId = :tenantId, totalValueCents = :totalValue, cashBalanceCents = :cash, positionCount = :posCount',
          ExpressionAttributeNames: { '#ts': 'timestamp' },
          ExpressionAttributeValues: {
            ':ts': now,
            ':now': now,
            ':typename': 'StreamSnapshot',
            ':tenantId': tenantId,
            ':totalValue': data.totalValueCents,
            ':cash': data.cashBalanceCents,
            ':posCount': data.positionCount,
          },
        }),
      );
    },
  );

  readonly getStreamSnapshot = this.log('getStreamSnapshot',
    async (tenantId: string, streamType: string): Promise<Record<string, unknown> | null> => {
      const pk = dashboardPk(tenantId);
      const result = await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { pk, sk: `StreamSnapshot#${streamType}` },
        }),
      );
      return (result.Item as Record<string, unknown>) ?? null;
    },
  );

  readonly upsertSimulationSummary = this.log('upsertSimulationSummary',
    async (
      tenantId: string,
      data: {
        actualTotalValueCents: number;
        simulatedTotalValueCents: number;
        actualReturnPercent: number;
        simulatedReturnPercent: number;
        returnDifferencePercent: number;
      },
    ): Promise<void> => {
      const pk = dashboardPk(tenantId);
      const now = getTime();

      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk, sk: 'SimulationSummary' },
          UpdateExpression: 'SET #ts = :ts, updatedAt = :now, __typename = :typename, tenantId = :tenantId, actualTotalValueCents = :actualTotal, simulatedTotalValueCents = :simTotal, actualReturnPercent = :actualRet, simulatedReturnPercent = :simRet, returnDifferencePercent = :retDiff',
          ExpressionAttributeNames: { '#ts': 'timestamp' },
          ExpressionAttributeValues: {
            ':ts': now,
            ':now': now,
            ':typename': 'SimulationSummary',
            ':tenantId': tenantId,
            ':actualTotal': data.actualTotalValueCents,
            ':simTotal': data.simulatedTotalValueCents,
            ':actualRet': data.actualReturnPercent,
            ':simRet': data.simulatedReturnPercent,
            ':retDiff': data.returnDifferencePercent,
          },
        }),
      );
    },
  );

  readonly getSimulationSummary = this.log('getSimulationSummary',
    async (tenantId: string): Promise<Record<string, unknown> | null> => {
      const pk = dashboardPk(tenantId);
      const result = await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { pk, sk: 'SimulationSummary' },
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
