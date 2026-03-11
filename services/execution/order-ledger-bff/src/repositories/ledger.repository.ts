import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { TableRepository, getTime, type TableEntry } from '@nestfolio/platform-core';
import { withMethodLogging } from '@nestfolio/lambda-utils';

export interface LedgerEntryItem {
  readonly tenantId: string;
  readonly streamType: 'actual' | 'simulated';
  readonly orderId: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly payload: Record<string, unknown>;
  readonly timestamp: string;
  readonly sequenceNo: number;
  readonly decisionId?: string;
}

export class LedgerRepository extends TableRepository {
  private readonly log = withMethodLogging('LedgerRepository');

  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

  readonly putLedgerEntry = this.log('putLedgerEntry',
    async (entry: LedgerEntryItem): Promise<void> => {
      const item: TableEntry = {
        pk: `OrderStream#${entry.tenantId}#${entry.streamType}#${entry.orderId}`,
        sk: `Event#${String(entry.sequenceNo).padStart(8, '0')}#${entry.eventId}`,
        __typename: 'LedgerEntry',
        tenantId: entry.tenantId,
        timestamp: entry.timestamp,
        streamType: entry.streamType,
        orderId: entry.orderId,
        eventId: entry.eventId,
        eventType: entry.eventType,
        payload: entry.payload,
        sequenceNo: entry.sequenceNo,
        decisionId: entry.decisionId,
      };
      await this.put(item);
    },
  );

  readonly nextSequence = this.log('nextSequence',
    async (tenantId: string, streamType: string, orderId: string): Promise<number> => {
      const result = await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            pk: `Sequence#${tenantId}#${streamType}#${orderId}`,
            sk: 'Counter',
          },
          UpdateExpression: 'ADD lastSequence :inc SET #typ = :typ, tenantId = :tid, #ts = :ts',
          ExpressionAttributeNames: { '#typ': '__typename', '#ts': 'timestamp' },
          ExpressionAttributeValues: {
            ':inc': 1,
            ':typ': 'SequenceCounter',
            ':tid': tenantId,
            ':ts': getTime(),
          },
          ReturnValues: 'ALL_NEW',
        }),
      );
      return (result.Attributes?.['lastSequence'] as number) ?? 1;
    },
  );

  readonly getLatestSnapshot = this.log('getLatestSnapshot',
    async (
      tenantId: string,
      streamType: string,
    ): Promise<Record<string, unknown> | null> => {
      const pk = `Portfolio#${tenantId}#${streamType}`;
      const items = await this.queryByPk(pk, 'Latest');
      return items.length > 0 ? items[0] : null;
    },
  );

  readonly savePortfolioSnapshot = this.log('savePortfolioSnapshot',
    async (
      tenantId: string,
      streamType: string,
      data: {
        state: Record<string, unknown>;
        lastEventSequence: number;
        version: number;
      },
    ): Promise<void> => {
      const now = getTime();
      const item: TableEntry = {
        pk: `Portfolio#${tenantId}#${streamType}`,
        sk: 'Latest',
        __typename: 'PortfolioSnapshot',
        tenantId,
        timestamp: now,
        streamType,
        positions: (data.state as any).positions ?? {},
        cashBalanceCents: (data.state as any).cashBalanceCents ?? 0,
        totalValueCents: this.computeTotalValue(data.state),
        positionCount: Object.keys((data.state as any).positions ?? {}).length,
        lastEventSequence: data.lastEventSequence,
        version: data.version,
        snapshotAt: now,
      };
      await this.put(item);
    },
  );

  readonly upsertPositionSnapshot = this.log('upsertPositionSnapshot',
    async (
      tenantId: string,
      streamType: string,
      symbol: string,
      position: Record<string, unknown>,
    ): Promise<void> => {
      const now = getTime();
      const item: TableEntry = {
        pk: `Position#${tenantId}#${streamType}`,
        sk: `Position#${symbol}`,
        __typename: 'PositionSnapshot',
        tenantId,
        timestamp: now,
        streamType,
        symbol,
        quantity: position['quantity'] as number,
        averageCostBasis: position['averageCostBasis'] as number,
        totalCostBasis: position['totalCostBasis'] as number,
        lastFillPrice: position['lastFillPrice'] as number,
      };
      await this.put(item);
    },
  );

  readonly saveCheckpoint = this.log('saveCheckpoint',
    async (
      tenantId: string,
      streamType: string,
      date: string,
      state: Record<string, unknown>,
    ): Promise<void> => {
      const now = getTime();
      const item: TableEntry = {
        pk: `Portfolio#${tenantId}#${streamType}`,
        sk: `Checkpoint#${date}`,
        __typename: 'PortfolioCheckpoint',
        tenantId,
        timestamp: now,
        streamType,
        positions: (state as any).positions ?? {},
        cashBalanceCents: (state as any).cashBalanceCents ?? 0,
        totalValueCents: this.computeTotalValue(state),
        snapshotAt: now,
      };
      await this.put(item);
    },
  );

  readonly queryEntriesSince = this.log('queryEntriesSince',
    async (
      tenantId: string,
      streamType: string,
      sinceSequence: number,
    ): Promise<Record<string, unknown>[]> => {
      return this.queryAll({
        TableName: this.tableName,
        IndexName: 'tenantId-index',
        KeyConditionExpression: 'tenantId = :tid AND __typename = :typ',
        FilterExpression: 'streamType = :st AND sequenceNo > :seq',
        ExpressionAttributeValues: {
          ':tid': tenantId,
          ':typ': 'LedgerEntry',
          ':st': streamType,
          ':seq': sinceSequence,
        },
      });
    },
  );

  readonly getOrderHistory = this.log('getOrderHistory',
    async (
      tenantId: string,
      streamType: string,
      options?: { orderId?: string; limit?: number; cursor?: string },
    ): Promise<{ entries: Record<string, unknown>[]; nextCursor?: string }> => {
      if (options?.orderId) {
        const pk = `OrderStream#${tenantId}#${streamType}#${options.orderId}`;
        const items = await this.queryByPk(pk, 'Event#');
        return { entries: items };
      }

      const items = await this.queryAll({
        TableName: this.tableName,
        IndexName: 'tenantId-index',
        KeyConditionExpression: 'tenantId = :tid AND __typename = :typ',
        FilterExpression: 'streamType = :st',
        ExpressionAttributeValues: {
          ':tid': tenantId,
          ':typ': 'LedgerEntry',
          ':st': streamType,
        },
        Limit: options?.limit ?? 50,
        ...(options?.cursor ? { ExclusiveStartKey: JSON.parse(Buffer.from(options.cursor, 'base64').toString()) } : {}),
      });

      return { entries: items };
    },
  );

  readonly countDistinctDecisions = this.log('countDistinctDecisions',
    async (tenantId: string, streamType: string): Promise<number> => {
      const entries = await this.queryAll({
        TableName: this.tableName,
        IndexName: 'tenantId-index',
        KeyConditionExpression: 'tenantId = :tid AND __typename = :typ',
        FilterExpression: 'streamType = :st AND attribute_exists(decisionId)',
        ExpressionAttributeValues: {
          ':tid': tenantId,
          ':typ': 'LedgerEntry',
          ':st': streamType,
        },
        ProjectionExpression: 'decisionId',
      });
      const uniqueDecisions = new Set(entries.map((e) => e['decisionId'] as string));
      return uniqueDecisions.size;
    },
  );

  readonly getPositionSnapshots = this.log('getPositionSnapshots',
    async (tenantId: string, streamType: string): Promise<Record<string, unknown>[]> => {
      const pk = `Position#${tenantId}#${streamType}`;
      return this.queryByPk(pk, 'Position#');
    },
  );

  readonly getEarliestCheckpoint = this.log('getEarliestCheckpoint',
    async (tenantId: string, streamType: string): Promise<Record<string, unknown> | null> => {
      const pk = `Portfolio#${tenantId}#${streamType}`;
      const items = await this.queryAll({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: { ':pk': pk, ':prefix': 'Checkpoint#' },
        ScanIndexForward: true,
        Limit: 1,
      });
      return items.length > 0 ? items[0] : null;
    },
  );

  readonly getCheckpointBefore = this.log('getCheckpointBefore',
    async (
      tenantId: string,
      streamType: string,
      targetDate: string,
    ): Promise<Record<string, unknown> | null> => {
      const pk = `Portfolio#${tenantId}#${streamType}`;
      const items = await this.queryAll({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
        ExpressionAttributeValues: {
          ':pk': pk,
          ':start': 'Checkpoint#',
          ':end': `Checkpoint#${targetDate}`,
        },
        ScanIndexForward: false,
        Limit: 1,
      });
      return items.length > 0 ? items[0] : null;
    },
  );

  readonly queryEntriesBetween = this.log('queryEntriesBetween',
    async (
      tenantId: string,
      streamType: string,
      sinceTimestamp: string,
      untilTimestamp: string,
    ): Promise<Record<string, unknown>[]> => {
      return this.queryAll({
        TableName: this.tableName,
        IndexName: 'tenantId-index',
        KeyConditionExpression: 'tenantId = :tid AND __typename = :typ',
        FilterExpression: 'streamType = :st AND #ts > :since AND #ts <= :until',
        ExpressionAttributeNames: { '#ts': 'timestamp' },
        ExpressionAttributeValues: {
          ':tid': tenantId,
          ':typ': 'LedgerEntry',
          ':st': streamType,
          ':since': sinceTimestamp,
          ':until': untilTimestamp,
        },
      });
    },
  );

  private computeTotalValue(state: Record<string, unknown>): number {
    const positions = (state as any).positions ?? {};
    let total = (state as any).cashBalanceCents ?? 0;
    for (const pos of Object.values(positions) as Array<{ quantity: number; lastFillPrice: number }>) {
      total += Math.round(pos.quantity * pos.lastFillPrice * 100);
    }
    return total;
  }
}
