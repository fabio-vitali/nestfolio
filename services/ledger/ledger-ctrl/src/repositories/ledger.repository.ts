import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { UpdateCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  TableRepository, getTime, type TableEntry, type RequestContext,
} from '@nestfolio/event-processor';
import { withMethodLogging } from '@nestfolio/event-processor';

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

export interface SnapshotWithEvents {
  readonly streamType: 'actual' | 'simulated';
  readonly state: SnapshotState;
  readonly lastEventSequence: number;
  readonly version: number;
  readonly balanceChanged: boolean;
  readonly positionsChanged: boolean;
  readonly ttlDays: number;
}

export type TaxLot = {
  pk: string;
  sk: string;
  __typename: 'TaxLot';
  tenantId: string;
  lotId: string;
  symbol: string;
  quantity: number;
  costBasisPerShare: number;
  acquiredAt: string;
  status: 'open' | 'closed';
};

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
      const item: TableEntry = {
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

  readonly saveSnapshotWithEvents = this.log('saveSnapshotWithEvents',
    async (data: SnapshotWithEvents, ctx: RequestContext): Promise<void> => {
      const now = getTime();
      const pk = `Account#${ctx.tenantId}#${data.streamType}`;
      const totalValueCents = this.computeTotalValue(data.state);

      const snapshot: SnapshotState = {
        positions: data.state.positions,
        cashBalanceCents: data.state.cashBalanceCents,
        lastEventSequence: data.lastEventSequence,
      };

      const transactItems: Record<string, unknown>[] = [
        // Snapshot item
        {
          Put: {
            TableName: this.tableName,
            Item: {
              pk,
              sk: 'Snapshot#latest',
              __typename: 'AccountSnapshot',
              ...ctx,
              timestamp: now,
              streamType: data.streamType,
              positions: data.state.positions,
              cashBalanceCents: data.state.cashBalanceCents,
              totalValueCents,
              positionCount: Object.keys(data.state.positions).length,
              lastEventSequence: data.lastEventSequence,
              version: data.version,
              snapshotAt: now,
            },
          },
        },
      ];

      // BalanceEvent — written when cash balance changed
      if (data.balanceChanged) {
        transactItems.push({
          Put: {
            TableName: this.tableName,
            Item: {
              pk,
              sk: `BalanceEvent#${now}#${data.version}`,
              __typename: 'BalanceEvent',
              ...ctx,
              timestamp: now,
              streamType: data.streamType,
              cashBalanceCents: data.state.cashBalanceCents,
              totalValueCents,
              version: data.version,
              snapshot,
            },
          },
        });
      }

      // PortfolioEvent — written when positions changed
      if (data.positionsChanged) {
        transactItems.push({
          Put: {
            TableName: this.tableName,
            Item: {
              pk,
              sk: `PortfolioEvent#${now}#${data.version}`,
              __typename: 'PortfolioEvent',
              ...ctx,
              timestamp: now,
              streamType: data.streamType,
              positions: data.state.positions,
              positionCount: Object.keys(data.state.positions).length,
              totalValueCents,
              version: data.version,
              snapshot,
            },
          },
        });
      }

      // LedgerEntryEvent — always written when snapshot updates
      transactItems.push({
        Put: {
          TableName: this.tableName,
          Item: {
            pk,
            sk: `LedgerEntryEvent#${now}#${data.version}`,
            __typename: 'LedgerEntryEvent',
            ...ctx,
            timestamp: now,
            streamType: data.streamType,
            lastEventSequence: data.lastEventSequence,
            version: data.version,
            snapshot,
          },
        },
      });

      // SnapshotHistory — append-only, TTL-bounded
      transactItems.push({
        Put: {
          TableName: this.tableName,
          Item: {
            pk,
            sk: `SnapshotAt#${now}`,
            __typename: 'SnapshotHistory',
            ...ctx,
            streamType: data.streamType,
            timestamp: now,
            positions: data.state.positions,
            cashBalanceCents: data.state.cashBalanceCents,
            lastEventSequence: data.lastEventSequence,
            ttl: Math.floor(Date.now() / 1000) + (data.ttlDays * 86400),
          },
        },
      });

      await this.transactWrite({ TransactItems: transactItems });
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
      const item: TableEntry = {
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
    async (lot: TaxLot): Promise<void> => {
      await this.put(lot);
    },
  );

  readonly getOpenLotsBySymbol = this.log('getOpenLotsBySymbol',
    async (tenantId: string, symbol: string): Promise<TaxLot[]> => {
      return this.queryAll<TaxLot>({
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
