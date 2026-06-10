import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { TableRepository, getTime, type TableEntry, type RequestContext } from '@nestfolio/event-processor';
import { withMethodLogging, guardedWrite } from '@nestfolio/event-processor';
import type { VirtualTrade, VirtualCashBalance, VirtualPosition, VirtualSnapshot } from '../domain/contracts';

// executedAt / createdAt are set by the repository, not passed by callers
type VirtualTradeInput = Omit<VirtualTrade, 'executedAt'>;
type VirtualSnapshotInput = Omit<VirtualSnapshot, 'createdAt'>;

function ledgerPk(tenantId: string, userId: string): string {
  return `VirtualLedger#${tenantId}#${userId}`;
}

export class VirtualLedgerRepository extends TableRepository {
  private readonly log = withMethodLogging('VirtualLedgerRepository');

  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

  readonly getCashBalance = this.log('getCashBalance',
    async (
      tenantId: string,
      userId: string,
      currency: string,
    ): Promise<Record<string, unknown> | null> => {
      const pk = ledgerPk(tenantId, userId);
      const result = await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { pk, sk: `CashBalance#${currency}` },
        }),
      );
      return result.Item ?? null;
    },
  );

  readonly initializeCashBalance = this.log('initializeCashBalance',
    async (
      currency: string,
      amount: number,
      ctx: RequestContext,
    ): Promise<void> => {
      const now = getTime();
      const item = {
        pk: ledgerPk(ctx.tenantId, ctx.userId),
        sk: `CashBalance#${currency}`,
        __typename: 'VirtualCashBalance' as const,
        ...ctx,
        timestamp: now,
        currency,
        balance: amount,
        version: 1,
        updatedAt: now,
        createdAt: now,
      } satisfies TableEntry<VirtualCashBalance, RequestContext> & { __typename: 'VirtualCashBalance'; timestamp: string };
      await this.put(item);
    },
  );

  readonly updateCashBalanceConditional = this.log('updateCashBalanceConditional',
    async (
      currency: string,
      newBalance: number,
      expectedVersion: number,
      ctx: RequestContext,
    ): Promise<void> => {
      const now = getTime();
      const pk = ledgerPk(ctx.tenantId, ctx.userId);
      const item = {
        pk,
        sk: `CashBalance#${currency}`,
        __typename: 'VirtualCashBalance' as const,
        ...ctx,
        timestamp: now,
        currency,
        balance: newBalance,
        version: expectedVersion + 1,
        updatedAt: now,
        createdAt: now,
      } satisfies TableEntry<VirtualCashBalance, RequestContext> & { __typename: 'VirtualCashBalance'; timestamp: string };
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: '#v = :expectedVersion',
          ExpressionAttributeNames: { '#v': 'version' },
          ExpressionAttributeValues: { ':expectedVersion': expectedVersion },
        }),
      );
    },
  );

  readonly addToCashBalance = this.log('addToCashBalance',
    async (
      tenantId: string,
      userId: string,
      currency: string,
      amount: number,
    ): Promise<void> => {
      const now = getTime();
      const pk = ledgerPk(tenantId, userId);
      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk, sk: `CashBalance#${currency}` },
          UpdateExpression: 'ADD balance :amount SET #ts = :ts, updatedAt = :now',
          ExpressionAttributeNames: { '#ts': 'timestamp' },
          ExpressionAttributeValues: { ':amount': amount, ':ts': now, ':now': now },
        }),
      );
    },
  );

  readonly guardedAddToCashBalance = this.log('guardedAddToCashBalance',
    async (
      tenantId: string,
      userId: string,
      currency: string,
      amount: number,
      eventId: string,
    ): Promise<boolean> => {
      const now = getTime();
      const pk = ledgerPk(tenantId, userId);
      return guardedWrite(
        this.docClient,
        this.tableName,
        { pk, sk: `ProcessedEvent#${eventId}` },
        [
          {
            Update: {
              TableName: this.tableName,
              Key: { pk, sk: `CashBalance#${currency}` },
              UpdateExpression: 'ADD balance :amount SET #ts = :ts, updatedAt = :now',
              ExpressionAttributeNames: { '#ts': 'timestamp' },
              ExpressionAttributeValues: { ':amount': amount, ':ts': now, ':now': now },
            },
          },
        ],
        604800, // 7-day TTL for financial operations
      );
    },
  );

  readonly getPosition = this.log('getPosition',
    async (
      tenantId: string,
      userId: string,
      symbol: string,
    ): Promise<Record<string, unknown> | null> => {
      const pk = ledgerPk(tenantId, userId);
      const result = await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { pk, sk: `Position#${symbol}` },
        }),
      );
      return result.Item ?? null;
    },
  );

  readonly getAllPositions = this.log('getAllPositions',
    async (
      tenantId: string,
      userId: string,
    ): Promise<Record<string, unknown>[]> => {
      const pk = ledgerPk(tenantId, userId);
      return this.queryByPk(pk, 'Position#');
    },
  );

  readonly executeTrade = this.log('executeTrade',
    async (
      trade: VirtualTradeInput,
      ctx: RequestContext,
    ): Promise<void> => {
      const now = getTime();
      const pk = ledgerPk(ctx.tenantId, ctx.userId);

      // Read current cash version for optimistic locking
      const currentCash = await this.getCashBalance(ctx.tenantId, ctx.userId, 'USD');
      const currentVersion = (currentCash?.version as number) ?? 0;

      const cashItem = {
        pk,
        sk: `CashBalance#USD`,
        __typename: 'VirtualCashBalance' as const,
        ...ctx,
        timestamp: now,
        currency: 'USD',
        balance: trade.cashAfter,
        version: currentVersion + 1,
        updatedAt: now,
        createdAt: now,
      } satisfies TableEntry<VirtualCashBalance, RequestContext> & { __typename: 'VirtualCashBalance'; timestamp: string };

      const cashUpdate = {
        Put: {
          TableName: this.tableName,
          Item: cashItem,
          ...(currentVersion > 0
            ? {
                ConditionExpression: '#v = :expectedVersion',
                ExpressionAttributeNames: { '#v': 'version' },
                ExpressionAttributeValues: { ':expectedVersion': currentVersion },
              }
            : {
                ConditionExpression: 'attribute_not_exists(#v)',
                ExpressionAttributeNames: { '#v': 'version' },
              }),
        },
      };

      const currentPosition = await this.getPosition(ctx.tenantId, ctx.userId, trade.symbol);
      const currentQty = (currentPosition?.quantity as number) ?? 0;
      const currentAvgCost = (currentPosition?.averageCostBasis as number) ?? 0;

      let newQty: number;
      let newAvgCost: number;
      if (trade.side === 'BUY') {
        newQty = currentQty + trade.quantity;
        // Weighted average cost basis
        newAvgCost =
          newQty > 0
            ? (currentQty * currentAvgCost + trade.quantity * trade.fillPrice) / newQty
            : 0;
      } else {
        newQty = currentQty - trade.quantity;
        newAvgCost = newQty > 0 ? currentAvgCost : 0;
      }

      const positionUpdate = {
        Put: {
          TableName: this.tableName,
          Item: {
            pk,
            sk: `Position#${trade.symbol}`,
            __typename: 'VirtualPosition' as const,
            ...ctx,
            timestamp: now,
            symbol: trade.symbol,
            quantity: newQty,
            averageCostBasis: newAvgCost,
            marketValue: newQty * trade.fillPrice,
            updatedAt: now,
            createdAt: now,
          } satisfies TableEntry<VirtualPosition, RequestContext> & { __typename: 'VirtualPosition'; timestamp: string },
        },
      };

      const tradeId = trade.tradeId;
      const tradeRecord = {
        Put: {
          TableName: this.tableName,
          ConditionExpression: 'attribute_not_exists(pk)',
          Item: {
            pk,
            sk: `Trade#${tradeId}`,
            __typename: 'VirtualTrade' as const,
            ...ctx,
            timestamp: now,
            tradeId,
            orderId: trade.orderId,
            symbol: trade.symbol,
            side: trade.side,
            quantity: trade.quantity,
            fillPrice: trade.fillPrice,
            totalValue: trade.totalValue,
            cashBefore: trade.cashBefore,
            cashAfter: trade.cashAfter,
            executedAt: now,
            createdAt: now,
          } satisfies TableEntry<VirtualTrade, RequestContext> & { __typename: 'VirtualTrade'; timestamp: string },
        },
      };

      await this.transactWrite({
        TransactItems: [cashUpdate, positionUpdate, tradeRecord],
      });
    },
  );

  readonly getTradeHistory = this.log('getTradeHistory',
    async (
      tenantId: string,
      userId: string,
      limit?: number,
    ): Promise<Record<string, unknown>[]> => {
      const pk = ledgerPk(tenantId, userId);
      const params = {
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':pk': pk,
          ':sk': 'Trade#',
        },
        ScanIndexForward: false,
        ...(limit ? { Limit: limit } : {}),
      };
      return this.queryAll(params);
    },
  );

  readonly createSnapshot = this.log('createSnapshot',
    async (
      snapshot: VirtualSnapshotInput,
      ctx: RequestContext,
    ): Promise<void> => {
      const now = getTime();
      const item = {
        pk: ledgerPk(ctx.tenantId, ctx.userId),
        sk: `Snapshot#${snapshot.date}`,
        __typename: 'VirtualSnapshot' as const,
        ...ctx,
        timestamp: now,
        ...snapshot,
        createdAt: now,
      } satisfies TableEntry<VirtualSnapshot, RequestContext> & { __typename: 'VirtualSnapshot'; timestamp: string };
      await this.put(item);
    },
  );

  readonly getLatestSnapshot = this.log('getLatestSnapshot',
    async (
      tenantId: string,
      userId: string,
    ): Promise<Record<string, unknown> | null> => {
      const pk = ledgerPk(tenantId, userId);
      const params = {
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':pk': pk,
          ':sk': 'Snapshot#',
        },
        ScanIndexForward: false,
        Limit: 1,
      };
      const results = await this.queryAll(params);
      return results.length > 0 ? results[0] as Record<string, unknown> : null;
    },
  );
}
