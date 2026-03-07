import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { TableRepository, getUUID, getTime, log, type TableEntry } from '@nestfolio/platform-core';
import type { ProposedTrade } from '@nestfolio/domain-core';

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
  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

  @log()
  async createOrder(
    tenantId: string,
    orderId: string,
    decisionPacketId: string,
    trades: ProposedTrade[],
  ): Promise<void> {
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
    };
    await this.put(item);
  }

  @log()
  async getOrder(tenantId: string, orderId: string): Promise<Record<string, unknown> | null> {
    const pk = orderPk(tenantId, orderId);
    const items = await this.queryByPk(pk, 'Order');
    return items.length > 0 ? items[0] : null;
  }

  @log()
  async updateOrderStatus(
    tenantId: string,
    orderId: string,
    status: string,
    details?: Record<string, unknown>,
  ): Promise<void> {
    const pk = orderPk(tenantId, orderId);
    const now = getTime();

    const orderUpdate: TableEntry = {
      pk,
      sk: 'Order',
      __typename: 'Order',
      tenantId,
      timestamp: now,
      orderId,
      status,
      updatedAt: now,
      ...(details ?? {}),
    };

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
        { Put: { TableName: this.tableName, Item: orderUpdate } },
        { Put: { TableName: this.tableName, Item: editEvent } },
      ],
    });
  }

  @log()
  async createStagedOrder(
    tenantId: string,
    orderId: string,
    order: Record<string, unknown>,
  ): Promise<void> {
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
  }

  @log()
  async getStagedOrders(tenantId: string): Promise<Record<string, unknown>[]> {
    return this.queryAll({
      TableName: this.tableName,
      IndexName: 'tenantId-index',
      KeyConditionExpression: 'tenantId = :tid AND __typename = :typ',
      ExpressionAttributeValues: { ':tid': tenantId, ':typ': 'StagedOrder' },
    });
  }

  @log()
  async deleteStagedOrder(tenantId: string, orderId: string): Promise<void> {
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { pk: stagedOrderPk(tenantId, orderId), sk: 'StagedOrder' },
      }),
    );
  }

  @log()
  async setCoolDown(tenantId: string, instrument: string, expiresAt: string): Promise<void> {
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
  }

  @log()
  async getCoolDown(tenantId: string, instrument: string): Promise<Record<string, unknown> | null> {
    const pk = coolDownPk(tenantId, instrument);
    const items = await this.queryByPk(pk, 'CoolDown');
    return items.length > 0 ? items[0] : null;
  }

  @log()
  async getConflictingStagedOrders(
    tenantId: string,
    instruments: string[],
  ): Promise<Record<string, unknown>[]> {
    const staged = await this.getStagedOrders(tenantId);
    return staged.filter((order) => {
      const trades = (order['proposedTrades'] as Array<{ symbol: string }>) ?? [];
      return trades.some((t) => instruments.includes(t.symbol));
    });
  }
}
