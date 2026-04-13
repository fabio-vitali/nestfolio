import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchGetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { TableRepository, getTime, type TableEntry, type RequestContext } from '@nestfolio/event-processor';
import { withMethodLogging } from '@nestfolio/event-processor';
import type { ProposedTrade } from '@nestfolio/advisory-adpt/domain';

function orderPk(tenantId: string, orderId: string): string {
  return `Order#${tenantId}#${orderId}`;
}

function stagedOrderPk(tenantId: string, orderId: string): string {
  return `StagedOrder#${tenantId}#${orderId}`;
}

function coolDownPk(tenantId: string, instrument: string): string {
  return `CoolDown#${tenantId}#${instrument}`;
}

export class OrderRepository extends TableRepository {
  private readonly log = withMethodLogging('OrderRepository');

  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

  readonly createOrder = this.log('createOrder',
    async (
      orderId: string,
      decisionPacketId: string,
      trades: ProposedTrade[],
      ctx: RequestContext,
      sourceEventId?: string,
    ): Promise<boolean> => {
      const now = getTime();
      const item: TableEntry = {
        pk: orderPk(ctx.tenantId, orderId),
        sk: 'Order',
        __typename: 'Order',
        ...ctx,
        timestamp: now,
        orderId,
        decisionPacketId,
        proposedTrades: trades,
        status: 'PENDING',
        createdAt: now,
        updatedAt: now,
        ...(sourceEventId ? { sourceEventId } : {}),
      };
      return this.putIfNotExists(item);
    },
  );

  readonly getOrder = this.log('getOrder',
    async (tenantId: string, orderId: string): Promise<Record<string, unknown> | null> => {
      const pk = orderPk(tenantId, orderId);
      const items = await this.queryByPk(pk, 'Order');
      return items.length > 0 ? items[0] : null;
    },
  );

  readonly updateOrderStatus = this.log('updateOrderStatus',
    async (
      tenantId: string,
      orderId: string,
      status: string,
      details?: Record<string, unknown>,
    ): Promise<void> => {
      const pk = orderPk(tenantId, orderId);
      const now = getTime();

      await this.transactWrite({
        TransactItems: [
          this.buildTransactUpdate(pk, 'Order', {
            status,
            updatedAt: now,
            timestamp: now,
            ...(details ?? {}),
          }) as any,
        ],
      });
    },
  );

  readonly createStagedOrder = this.log('createStagedOrder',
    async (
      orderId: string,
      order: Record<string, unknown>,
      ctx: RequestContext,
    ): Promise<void> => {
      const now = getTime();
      const item: TableEntry = {
        pk: stagedOrderPk(ctx.tenantId, orderId),
        sk: 'StagedOrder',
        __typename: 'StagedOrder',
        ...ctx,
        timestamp: now,
        orderId,
        ...order,
        stagedAt: now,
      };
      await this.put(item);
    },
  );

  readonly getStagedOrders = this.log('getStagedOrders',
    async (tenantId: string): Promise<Record<string, unknown>[]> => {
      return this.queryAll({
        TableName: this.tableName,
        IndexName: 'tenantId-index',
        KeyConditionExpression: 'tenantId = :tid AND #typ = :typ',
        ExpressionAttributeNames: { '#typ': '__typename' },
        ExpressionAttributeValues: { ':tid': tenantId, ':typ': 'StagedOrder' },
      });
    },
  );

  readonly getAllStagedOrders = this.log('getAllStagedOrders',
    async (): Promise<Record<string, unknown>[]> => {
      // Step 1: query KEYS_ONLY GSI for all StagedOrder pk/sk pairs
      const keys = await this.queryAll<{ pk: string; sk: string }>({
        TableName: this.tableName,
        IndexName: 'typename-timestamp-index',
        KeyConditionExpression: '#typ = :typ',
        ExpressionAttributeNames: { '#typ': '__typename' },
        ExpressionAttributeValues: { ':typ': 'StagedOrder' },
      });
      if (keys.length === 0) return [];

      // Step 2: BatchGetItem from main table for full items (batches of 100)
      const items: Record<string, unknown>[] = [];
      for (let i = 0; i < keys.length; i += 100) {
        const batch = keys.slice(i, i + 100);
        const result = await this.docClient.send(new BatchGetCommand({
          RequestItems: {
            [this.tableName]: {
              Keys: batch.map((k) => ({ pk: k.pk, sk: k.sk })),
            },
          },
        }));
        items.push(...(result.Responses?.[this.tableName] ?? []));
      }
      return items;
    },
  );

  readonly deleteStagedOrder = this.log('deleteStagedOrder',
    async (tenantId: string, orderId: string): Promise<void> => {
      await this.docClient.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: { pk: stagedOrderPk(tenantId, orderId), sk: 'StagedOrder' },
        }),
      );
    },
  );

  readonly setCoolDown = this.log('setCoolDown',
    async (instrument: string, expiresAt: string, ctx: RequestContext): Promise<void> => {
      const now = getTime();
      const item: TableEntry = {
        pk: coolDownPk(ctx.tenantId, instrument),
        sk: 'CoolDown',
        __typename: 'CoolDown',
        ...ctx,
        timestamp: now,
        instrument,
        expiresAt,
        createdAt: now,
      };
      await this.put(item);
    },
  );

  readonly getCoolDown = this.log('getCoolDown',
    async (tenantId: string, instrument: string): Promise<Record<string, unknown> | null> => {
      const pk = coolDownPk(tenantId, instrument);
      const items = await this.queryByPk(pk, 'CoolDown');
      return items.length > 0 ? items[0] : null;
    },
  );

  readonly getConflictingStagedOrders = this.log('getConflictingStagedOrders',
    async (
      tenantId: string,
      instruments: string[],
    ): Promise<Record<string, unknown>[]> => {
      const staged = await this.getStagedOrders(tenantId);
      return staged.filter((order) => {
        const trades = (order['proposedTrades'] as Array<{ symbol: string }>) ?? [];
        return trades.some((t) => instruments.includes(t.symbol));
      });
    },
  );
}
