import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { TableRepository, getUUID, getTime, type TableEntry } from '@nestfolio/event-processor';
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
      tenantId: string,
      orderId: string,
      decisionPacketId: string,
      trades: ProposedTrade[],
      sourceEventId?: string,
    ): Promise<boolean> => {
      const now = getTime();
      const item: TableEntry = {
        pk: orderPk(tenantId, orderId),
        sk: 'Order',
        __typename: 'Order',
        tenantId,
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

      const editEvent: TableEntry = {
        pk,
        sk: `EditEvent#${now}#${getUUID()}`,
        __typename: 'EditEvent',
        tenantId,
        timestamp: now,
        operation: 'replace',
        path: `/order/${orderId}/status`,
        value: { status, ...(details ?? {}) },
        editedBy: 'system',
        editedAt: now,
      };

      await this.transactWrite({
        TransactItems: [
          this.buildTransactUpdate(pk, 'Order', {
            status,
            updatedAt: now,
            timestamp: now,
            ...(details ?? {}),
          }) as any,
          { Put: { TableName: this.tableName, Item: editEvent } },
        ],
      });
    },
  );

  readonly createStagedOrder = this.log('createStagedOrder',
    async (
      tenantId: string,
      orderId: string,
      order: Record<string, unknown>,
    ): Promise<void> => {
      const now = getTime();
      const item: TableEntry = {
        pk: stagedOrderPk(tenantId, orderId),
        sk: 'StagedOrder',
        __typename: 'StagedOrder',
        tenantId,
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
        KeyConditionExpression: 'tenantId = :tid AND __typename = :typ',
        ExpressionAttributeValues: { ':tid': tenantId, ':typ': 'StagedOrder' },
      });
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
    async (tenantId: string, instrument: string, expiresAt: string): Promise<void> => {
      const now = getTime();
      const item: TableEntry = {
        pk: coolDownPk(tenantId, instrument),
        sk: 'CoolDown',
        __typename: 'CoolDown',
        tenantId,
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
