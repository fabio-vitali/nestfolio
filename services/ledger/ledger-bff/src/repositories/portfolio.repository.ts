import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { TableRepository, getTime, type TableEntry, type RequestContext } from '@nestfolio/event-processor';
import { withMethodLogging } from '@nestfolio/event-processor';

export interface PositionRecord {
  readonly symbol: string;
  readonly quantity: number;
  readonly averageCostBasis: number;
  readonly totalCostBasis: number;
  readonly lastFillPrice: number;
}

export interface HistoryEntry {
  readonly eventId: string;
  readonly eventType: string;
  readonly payload: Record<string, unknown>;
  readonly timestamp: string;
  readonly sequenceNo: number;
  readonly streamType?: string;
}

export interface CheckpointState {
  readonly cashBalanceCents: number;
  readonly positions: Record<string, PositionRecord>;
}

export class PortfolioRepository extends TableRepository {
  private readonly log = withMethodLogging('PortfolioRepository');

  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

  // --- Write operations ---

  readonly upsertBalance = this.log('upsertBalance',
    async (
      tenantId: string,
      balanceCents: number,
      deltaCents: number,
    ): Promise<void> => {
      const now = getTime();

      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk: `Portfolio#${tenantId}`, sk: 'Latest' },
          UpdateExpression: 'SET #ts = :ts, updatedAt = :now, __typename = :typename, tenantId = :tenantId, cashBalanceCents = :balance, lastDeltaCents = :delta',
          ExpressionAttributeNames: { '#ts': 'timestamp' },
          ExpressionAttributeValues: {
            ':ts': now,
            ':now': now,
            ':typename': 'PortfolioLatest',
            ':tenantId': tenantId,
            ':balance': balanceCents,
            ':delta': deltaCents,
          },
        }),
      );
    },
  );

  readonly upsertPosition = this.log('upsertPosition',
    async (symbol: string, position: PositionRecord, ctx: RequestContext): Promise<void> => {
      const now = getTime();

      const item: TableEntry = {
        pk: `Portfolio#${ctx.tenantId}`,
        sk: `Position#${symbol}`,
        __typename: 'Position',
        ...ctx,
        timestamp: now,
        symbol: position.symbol,
        quantity: position.quantity,
        averageCostBasis: position.averageCostBasis,
        totalCostBasis: position.totalCostBasis,
        lastFillPrice: position.lastFillPrice,
      };

      await this.put(item);
    },
  );

  readonly appendHistory = this.log('appendHistory',
    async (entry: HistoryEntry, ctx: RequestContext): Promise<void> => {
      const seqStr = String(entry.sequenceNo).padStart(8, '0');
      const item: TableEntry = {
        pk: `History#${ctx.tenantId}`,
        sk: `${seqStr}#${entry.eventId}`,
        __typename: 'HistoryEntry',
        ...ctx,
        timestamp: entry.timestamp,
        eventId: entry.eventId,
        eventType: entry.eventType,
        payload: entry.payload,
        sequenceNo: entry.sequenceNo,
        streamType: entry.streamType ?? 'actual',
      };

      await this.put(item);
    },
  );

  readonly saveCheckpoint = this.log('saveCheckpoint',
    async (date: string, state: CheckpointState, ctx: RequestContext): Promise<void> => {
      const now = getTime();
      const item: TableEntry = {
        pk: `Checkpoint#${ctx.tenantId}`,
        sk: `${date}`,
        __typename: 'Checkpoint',
        ...ctx,
        timestamp: now,
        positions: state.positions,
        cashBalanceCents: state.cashBalanceCents,
        snapshotAt: now,
      };

      // Conditional put: don't overwrite existing checkpoint for same date
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: 'attribute_not_exists(pk)',
        }),
      );
    },
  );

  readonly upsertSimulation = this.log('upsertSimulation',
    async (state: CheckpointState, ctx: RequestContext): Promise<void> => {
      const now = getTime();

      const item: TableEntry = {
        pk: `Simulation#${ctx.tenantId}`,
        sk: 'Latest',
        __typename: 'SimulationLatest',
        ...ctx,
        timestamp: now,
        cashBalanceCents: state.cashBalanceCents,
        positions: state.positions,
      };

      await this.put(item);
    },
  );

  readonly upsertSimulationPosition = this.log('upsertSimulationPosition',
    async (symbol: string, position: PositionRecord, ctx: RequestContext): Promise<void> => {
      const now = getTime();

      const item: TableEntry = {
        pk: `Simulation#${ctx.tenantId}`,
        sk: `Position#${symbol}`,
        __typename: 'SimulationPosition',
        ...ctx,
        timestamp: now,
        symbol: position.symbol,
        quantity: position.quantity,
        averageCostBasis: position.averageCostBasis,
        totalCostBasis: position.totalCostBasis,
        lastFillPrice: position.lastFillPrice,
      };

      await this.put(item);
    },
  );

  // --- Read operations ---

  readonly getLatest = this.log('getLatest',
    async (tenantId: string): Promise<Record<string, unknown> | null> => {
      const result = await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { pk: `Portfolio#${tenantId}`, sk: 'Latest' },
        }),
      );
      return (result.Item as Record<string, unknown>) ?? null;
    },
  );

  readonly getPositions = this.log('getPositions',
    async (tenantId: string): Promise<Record<string, unknown>[]> => {
      return this.queryByPk(`Portfolio#${tenantId}`, 'Position#');
    },
  );

  readonly getHistory = this.log('getHistory',
    async (
      tenantId: string,
      options?: { limit?: number; nextToken?: string },
    ): Promise<{ items: Record<string, unknown>[]; nextToken?: string }> => {
      const limit = options?.limit ?? 20;

      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': `History#${tenantId}` },
          ScanIndexForward: false,
          Limit: limit,
          ...(options?.nextToken ? {
            ExclusiveStartKey: JSON.parse(
              Buffer.from(options.nextToken, 'base64').toString(),
            ),
          } : {}),
        }),
      );

      const items = (result.Items ?? []) as Record<string, unknown>[];
      const lastKey = result.LastEvaluatedKey;
      const nextToken = lastKey
        ? Buffer.from(JSON.stringify(lastKey)).toString('base64')
        : undefined;

      return { items, nextToken };
    },
  );

  readonly getCheckpoints = this.log('getCheckpoints',
    async (tenantId: string): Promise<Record<string, unknown>[]> => {
      return this.queryByPk(`Checkpoint#${tenantId}`);
    },
  );

  readonly getCheckpointBefore = this.log('getCheckpointBefore',
    async (tenantId: string, date: string): Promise<Record<string, unknown> | null> => {
      const items = await this.queryAll({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND sk <= :date',
        ExpressionAttributeValues: {
          ':pk': `Checkpoint#${tenantId}`,
          ':date': date,
        },
        ScanIndexForward: false,
        Limit: 1,
      });
      return items.length > 0 ? items[0] : null;
    },
  );

  readonly getEntriesSince = this.log('getEntriesSince',
    async (tenantId: string, sinceSeq: number): Promise<Record<string, unknown>[]> => {
      const seqStr = String(sinceSeq).padStart(8, '0');
      return this.queryAll({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND sk > :seq',
        ExpressionAttributeValues: {
          ':pk': `History#${tenantId}`,
          ':seq': seqStr,
        },
        ScanIndexForward: true,
      });
    },
  );

  readonly getSimulationLatest = this.log('getSimulationLatest',
    async (tenantId: string): Promise<Record<string, unknown> | null> => {
      const result = await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { pk: `Simulation#${tenantId}`, sk: 'Latest' },
        }),
      );
      return (result.Item as Record<string, unknown>) ?? null;
    },
  );

  readonly getSimulationPositions = this.log('getSimulationPositions',
    async (tenantId: string): Promise<Record<string, unknown>[]> => {
      return this.queryByPk(`Simulation#${tenantId}`, 'Position#');
    },
  );

  // --- Snapshot-at operations (for time-travel without ledger-core) ---

  readonly saveSnapshotAt = this.log('saveSnapshotAt',
    async (
      streamType: string,
      timestamp: string,
      snapshot: CheckpointState,
      ttlDays: number,
      ctx: RequestContext,
    ): Promise<void> => {
      const ttl = Math.floor(Date.now() / 1000) + (ttlDays * 86400);
      await this.put({
        pk: `SnapshotAt#${ctx.tenantId}#${streamType}`,
        sk: timestamp,
        __typename: 'SnapshotAt',
        ...ctx,
        streamType,
        timestamp,
        positions: snapshot.positions,
        cashBalanceCents: snapshot.cashBalanceCents,
        ttl,
      });
    },
  );

  readonly getSnapshotAt = this.log('getSnapshotAt',
    async (tenantId: string, timestamp: string): Promise<Record<string, unknown> | null> => {
      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'pk = :pk AND sk <= :ts',
          ExpressionAttributeValues: {
            ':pk': `SnapshotAt#${tenantId}#actual`,
            ':ts': timestamp,
          },
          ScanIndexForward: false,
          Limit: 1,
        }),
      );
      const items = result.Items ?? [];
      return items.length > 0 ? (items[0] as Record<string, unknown>) : null;
    },
  );
}
