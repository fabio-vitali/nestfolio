import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { UpdateCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  TableRepository, getTime, withMethodLogging, type RequestContext, type TableEntry,
} from '@nestfolio/event-processor';
import type { TaxLot } from '../domain/contracts';

// ---------------------------------------------------------------------------
// DDB item & domain types (no RequestContext fields — context is a separate param)
// ---------------------------------------------------------------------------

export interface LedgerEntryItem {
  readonly streamType: 'actual' | 'simulated';
  readonly eventId: string;
  readonly eventType: string;
  readonly payload: Record<string, unknown>;
  readonly timestamp: string;
  readonly sequenceNo: number;
  readonly decisionId?: string;
}

export type PositionSnapshot = {
  readonly symbol: string;
  readonly quantity: number;
  readonly averageCostBasis: number;
  readonly totalCostBasis: number;
  readonly lastFillPrice: number;
};

export type SnapshotState = {
  readonly positions: Readonly<Record<string, PositionSnapshot>>;
  readonly cashBalanceCents: number;
  readonly lastEventSequence: number;
};

/** Persisted tax-lot row. Tenant-scoped only (no user/region). */
export type TaxLotEntry = TableEntry<TaxLot, { tenantId: string }> & { __typename: 'TaxLot' };

export type DispositionRecord = {
  lotId: string;
  symbol: string;
  quantitySold: number;
  costBasisPerShare: number;
  salePrice: number;
  realizedGain: number;
  holdingPeriod: 'short-term' | 'long-term';
  acquiredAt: string;
  soldAt: string;
};

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class LedgerRepository extends TableRepository {
  private readonly log = withMethodLogging('LedgerRepository');

  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

  readonly putLedgerEntry = this.log('putLedgerEntry',
    async (entry: LedgerEntryItem, ctx: RequestContext): Promise<boolean> => {
      const item = {
        pk: `Account#${ctx.tenantId}#${entry.streamType}`,
        sk: `Event#${entry.eventId}`,
        __typename: 'LedgerEntry',
        ...ctx,
        timestamp: entry.timestamp,
        streamType: entry.streamType,
        sourceEventId: entry.eventId,
        eventId: entry.eventId,
        eventType: entry.eventType,
        payload: entry.payload,
        sequenceNo: entry.sequenceNo,
        decisionId: entry.decisionId,
      };
      return this.putIfNotExists(item);
    },
  );

  readonly nextSequence = this.log('nextSequence',
    async (tenantId: string, streamType: string): Promise<number> => {
      const result = await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            pk: `Sequence#${tenantId}#${streamType}`,
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
      const pk = `Account#${tenantId}#${streamType}`;
      const items = await this.queryByPk(pk, 'Snapshot#latest');
      return items.length > 0 ? items[0] : null;
    },
  );

  readonly saveSnapshot = this.log('saveSnapshot',
    async (
      streamType: 'actual' | 'simulated',
      state: SnapshotState,
      lastEventSequence: number,
      version: number,
      ctx: RequestContext,
    ): Promise<void> => {
      const now = getTime();
      const pk = `Account#${ctx.tenantId}#${streamType}`;
      const totalValueCents = this.computeTotalValue(state);

      try {
        await this.docClient.send(
          new PutCommand({
            TableName: this.tableName,
            Item: {
              pk,
              sk: 'Snapshot#latest',
              __typename: 'AccountSnapshot',
              ...ctx,
              createdAt: now,
              timestamp: now,
              streamType,
              positions: state.positions,
              cashBalanceCents: state.cashBalanceCents,
              totalValueCents,
              positionCount: Object.keys(state.positions).length,
              lastEventSequence,
              version,
              snapshotAt: now,
            },
            ConditionExpression: 'attribute_not_exists(pk) OR version = :v',
            ExpressionAttributeValues: { ':v': version - 1 },
          }),
        );
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'ConditionalCheckFailedException') {
          throw new Error(`Snapshot conflict for ${pk} — concurrent update detected`);
        }
        throw err;
      }
    },
  );

  readonly saveCheckpoint = this.log('saveCheckpoint',
    async (
      streamType: string,
      date: string,
      state: SnapshotState,
      ctx: RequestContext,
    ): Promise<void> => {
      const now = getTime();
      const pk = `Account#${ctx.tenantId}#${streamType}`;
      const item = {
        pk,
        sk: `Checkpoint#${date}`,
        __typename: 'AccountCheckpoint',
        ...ctx,
        timestamp: now,
        streamType,
        positions: state.positions,
        cashBalanceCents: state.cashBalanceCents,
        totalValueCents: this.computeTotalValue(state),
        snapshotAt: now,
      };
      // Conditional write — only if checkpoint for this date doesn't exist yet
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: 'attribute_not_exists(pk)',
        }),
      );
    },
  );

  readonly queryEntriesSince = this.log('queryEntriesSince',
    async (
      tenantId: string,
      streamType: string,
      sinceSequence: number,
    ): Promise<Record<string, unknown>[]> => {
      const pk = `Account#${tenantId}#${streamType}`;
      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
          FilterExpression: 'sequenceNo > :sinceSeq',
          ExpressionAttributeValues: {
            ':pk': pk,
            ':sk': 'Event#',
            ':sinceSeq': sinceSequence,
          },
        }),
      );
      const items = result.Items ?? [];
      return items.sort((a, b) =>
        ((a['sequenceNo'] as number) ?? 0) - ((b['sequenceNo'] as number) ?? 0),
      );
    },
  );

  readonly putTaxLot = this.log('putTaxLot',
    async (lot: TaxLotEntry): Promise<void> => {
      await this.put(lot);
    },
  );

  readonly getOpenLotsBySymbol = this.log('getOpenLotsBySymbol',
    async (tenantId: string, symbol: string): Promise<TaxLotEntry[]> => {
      return this.queryAll<TaxLotEntry>({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
        FilterExpression: '#status = :open',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':pk': `TaxLot#${tenantId}#${symbol}`,
          ':skPrefix': 'Lot#',
          ':open': 'open',
        },
      });
    },
  );

  readonly closeTaxLot = this.log('closeTaxLot',
    async (pk: string, sk: string): Promise<void> => {
      await this.update(pk, sk, { status: 'closed', closedAt: getTime() });
    },
  );

  readonly updateTaxLotQuantity = this.log('updateTaxLotQuantity',
    async (pk: string, sk: string, newQuantity: number): Promise<void> => {
      await this.update(pk, sk, { quantity: newQuantity });
    },
  );

  readonly putDisposition = this.log('putDisposition',
    async (tenantId: string, disposition: DispositionRecord): Promise<void> => {
      await this.put({
        pk: `Disposition#${tenantId}#${disposition.symbol}`,
        sk: `Disp#${disposition.soldAt}#${disposition.lotId}`,
        __typename: 'DispositionRecord',
        tenantId,
        ...disposition,
        timestamp: getTime(),
      });
    },
  );

  readonly getDispositions = this.log('getDispositions',
    async (tenantId: string, symbol: string, year?: string): Promise<Record<string, unknown>[]> => {
      return this.queryAll({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': `Disposition#${tenantId}#${symbol}`,
          ':skPrefix': year ? `Disp#${year}` : 'Disp#',
        },
      });
    },
  );

  private computeTotalValue(state: SnapshotState): number {
    let total = state.cashBalanceCents;
    for (const pos of Object.values(state.positions)) {
      total += Math.round(pos.quantity * pos.lastFillPrice * 100);
    }
    return total;
  }
}
