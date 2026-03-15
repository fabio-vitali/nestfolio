import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { UpdateCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { TableRepository, getTime, type TableEntry } from '@nestfolio/platform-core';
import { withMethodLogging } from '@nestfolio/lambda-utils';

export interface LedgerEntryItem {
  readonly tenantId: string;
  readonly streamType: 'actual' | 'simulated';
  readonly eventId: string;
  readonly eventType: string;
  readonly payload: Record<string, unknown>;
  readonly timestamp: string;
  readonly sequenceNo: number;
  readonly decisionId?: string;
}

export interface SnapshotWithEvents {
  readonly tenantId: string;
  readonly streamType: 'actual' | 'simulated';
  readonly state: Record<string, unknown>;
  readonly lastEventSequence: number;
  readonly version: number;
  readonly balanceChanged: boolean;
  readonly positionsChanged: boolean;
  readonly userId?: string;
}

export class LedgerRepository extends TableRepository {
  private readonly log = withMethodLogging('LedgerRepository');

  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

  readonly putLedgerEntry = this.log('putLedgerEntry',
    async (entry: LedgerEntryItem): Promise<boolean> => {
      const item: TableEntry = {
        pk: `Account#${entry.tenantId}#${entry.streamType}`,
        sk: `Event#${entry.eventId}`,
        __typename: 'LedgerEntry',
        tenantId: entry.tenantId,
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
    async (data: SnapshotWithEvents): Promise<void> => {
      const now = getTime();
      const pk = `Account#${data.tenantId}#${data.streamType}`;
      const totalValueCents = this.computeTotalValue(data.state);

      const transactItems: Record<string, unknown>[] = [
        // Snapshot item
        {
          Put: {
            TableName: this.tableName,
            Item: {
              pk,
              sk: 'Snapshot#latest',
              __typename: 'AccountSnapshot',
              tenantId: data.tenantId,
              timestamp: now,
              streamType: data.streamType,
              positions: (data.state as any).positions ?? {},
              cashBalanceCents: (data.state as any).cashBalanceCents ?? 0,
              totalValueCents,
              positionCount: Object.keys((data.state as any).positions ?? {}).length,
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
              tenantId: data.tenantId,
              timestamp: now,
              streamType: data.streamType,
              cashBalanceCents: (data.state as any).cashBalanceCents ?? 0,
              totalValueCents,
              userId: data.userId ?? 'system',
              version: data.version,
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
              tenantId: data.tenantId,
              timestamp: now,
              streamType: data.streamType,
              positions: (data.state as any).positions ?? {},
              positionCount: Object.keys((data.state as any).positions ?? {}).length,
              totalValueCents,
              userId: data.userId ?? 'system',
              version: data.version,
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
            tenantId: data.tenantId,
            timestamp: now,
            streamType: data.streamType,
            lastEventSequence: data.lastEventSequence,
            userId: data.userId ?? 'system',
            version: data.version,
          },
        },
      });

      await this.transactWrite({ TransactItems: transactItems });
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
      const pk = `Account#${tenantId}#${streamType}`;
      const item: TableEntry = {
        pk,
        sk: `Checkpoint#${date}`,
        __typename: 'AccountCheckpoint',
        tenantId,
        timestamp: now,
        streamType,
        positions: (state as any).positions ?? {},
        cashBalanceCents: (state as any).cashBalanceCents ?? 0,
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
      return items.sort((a, b) => ((a as any).sequenceNo ?? 0) - ((b as any).sequenceNo ?? 0));
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
