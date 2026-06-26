import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchGetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { TableRepository, getTime } from '@nestfolio/event-processor';
import { withMethodLogging } from '@nestfolio/event-processor';

function orderPk(tenantId: string, orderId: string): string {
  return `Order#${tenantId}#${orderId}`;
}

function stagedOrderPk(tenantId: string, orderId: string): string {
  return `StagedOrder#${tenantId}#${orderId}`;
}

export class OrderRepository extends TableRepository {
  private readonly log = withMethodLogging('OrderRepository');

  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

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

  readonly getConflictingStagedOrders = this.log('getConflictingStagedOrders',
    async (
      tenantId: string,
      instruments: string[],
    ): Promise<Record<string, unknown>[]> => {
      const staged = await this.getStagedOrders(tenantId);
      return staged.filter((order) => instruments.includes(order['symbol'] as string));
    },
  );
}
