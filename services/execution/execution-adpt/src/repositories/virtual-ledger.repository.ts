import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { TableRepository, getTime, type TableEntry } from '@nestfolio/platform-core';
import { withMethodLogging } from '@nestfolio/lambda-utils';

function ledgerPk(tenantId: string, userId: string): string {
  return `VirtualLedger#${tenantId}#${userId}`;
}

export interface VirtualTrade {
  tradeId: string;
  orderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  fillPrice: number;
  totalValue: number;
  cashBefore: number;
  cashAfter: number;
}

export interface VirtualSnapshot {
  date: string;
  cashBalance: number;
  positions: Array<{ symbol: string; quantity: number; marketValue: number }>;
  totalValue: number;
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
      tenantId: string,
      userId: string,
      currency: string,
      amount: number,
    ): Promise<void> => {
      const now = getTime();
      const item: TableEntry = {
        pk: ledgerPk(tenantId, userId),
        sk: `CashBalance#${currency}`,
        __typename: 'VirtualCashBalance',
        tenantId,
        timestamp: now,
        userId,
        currency,
        balance: amount,
        version: 1,
        updatedAt: now,
      };
      await this.put(item);
    },
  );

  readonly updateCashBalanceConditional = this.log('updateCashBalanceConditional',
    async (
      tenantId: string,
      userId: string,
      currency: string,
      newBalance: number,
      expectedVersion: number,
    ): Promise<void> => {
      const now = getTime();
      const pk = ledgerPk(tenantId, userId);
      const item: TableEntry = {
        pk,
        sk: `CashBalance#${currency}`,
        __typename: 'VirtualCashBalance',
        tenantId,
        timestamp: now,
        userId,
        currency,
        balance: newBalance,
        version: expectedVersion + 1,
        updatedAt: now,
      };
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
      tenantId: string,
      userId: string,
      trade: VirtualTrade,
    ): Promise<void> => {
      const now = getTime();
      const pk = ledgerPk(tenantId, userId);

      // Read current cash version for optimistic locking
      const currentCash = await this.getCashBalance(tenantId, userId, 'USD');
      const currentVersion = (currentCash?.version as number) ?? 0;

      const cashUpdate = {
        Put: {
          TableName: this.tableName,
          Item: {
            pk,
            sk: `CashBalance#USD`,
            __typename: 'VirtualCashBalance',
            tenantId,
            timestamp: now,
            userId,
            currency: 'USD',
            balance: trade.cashAfter,
            version: currentVersion + 1,
            updatedAt: now,
          },
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

      const currentPosition = await this.getPosition(tenantId, userId, trade.symbol);
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
            __typename: 'VirtualPosition',
            tenantId,
            timestamp: now,
            userId,
            symbol: trade.symbol,
            quantity: newQty,
            averageCostBasis: newAvgCost,
            marketValue: newQty * trade.fillPrice,
            updatedAt: now,
          },
        },
      };

      const tradeId = trade.tradeId;
      const tradeRecord = {
        Put: {
          TableName: this.tableName,
          Item: {
            pk,
            sk: `Trade#${now}#${tradeId}`,
            __typename: 'VirtualTrade',
            tenantId,
            timestamp: now,
            userId,
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
          },
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
      tenantId: string,
      userId: string,
      snapshot: VirtualSnapshot,
    ): Promise<void> => {
      const now = getTime();
      const item: TableEntry = {
        pk: ledgerPk(tenantId, userId),
        sk: `Snapshot#${snapshot.date}`,
        __typename: 'VirtualSnapshot',
        tenantId,
        timestamp: now,
        userId,
        ...snapshot,
        createdAt: now,
      };
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
