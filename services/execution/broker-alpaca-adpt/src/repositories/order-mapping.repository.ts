import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { TableRepository, getTime, withMethodLogging, type TableEntry } from '@nestfolio/event-processor';
import type { AlpacaOrderResult } from '../domain/contracts';

export class OrderMappingRepository extends TableRepository {
  private readonly log = withMethodLogging('OrderMappingRepository');

  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

  readonly createMapping = this.log('createMapping',
    async (tenantId: string, nestfolioOrderId: string, alpacaOrderId: string, symbol: string, side: string, qty: number): Promise<void> => {
      const ts = getTime();
      await this.put({
        pk: `OrderMapping#${tenantId}#${nestfolioOrderId}`,
        sk: 'OrderMapping',
        __typename: 'AlpacaOrderResult',
        tenantId,
        nestfolioOrderId,
        alpacaOrderId,
        symbol,
        side,
        requestedQty: qty,
        status: 'PLACED',
        timestamp: ts,
        createdAt: ts,
      } satisfies TableEntry<AlpacaOrderResult, { tenantId: string }> & { __typename: 'AlpacaOrderResult'; timestamp: string });
      // Reverse lookup so getByAlpacaOrderId works
      await this.put({
        pk: `AlpacaOrder#${tenantId}#${alpacaOrderId}`,
        sk: 'OrderMapping',
        tenantId,
        nestfolioOrderId,
        alpacaOrderId,
      });
    },
  );

  readonly getByNestfolioOrderId = this.log('getByNestfolioOrderId',
    async (tenantId: string, nestfolioOrderId: string): Promise<Record<string, unknown> | null> => {
      const result = await this.docClient.send(new GetCommand({
        TableName: this.tableName,
        Key: { pk: `OrderMapping#${tenantId}#${nestfolioOrderId}`, sk: 'OrderMapping' },
      }));
      return result.Item ?? null;
    },
  );

  readonly getByAlpacaOrderId = this.log('getByAlpacaOrderId',
    async (tenantId: string, alpacaOrderId: string): Promise<Record<string, unknown> | null> => {
      const result = await this.docClient.send(new GetCommand({
        TableName: this.tableName,
        Key: { pk: `AlpacaOrder#${tenantId}#${alpacaOrderId}`, sk: 'OrderMapping' },
      }));
      return result.Item ?? null;
    },
  );

  readonly updateStatus = this.log('updateStatus',
    async (tenantId: string, nestfolioOrderId: string, status: string, updates: Record<string, unknown> = {}): Promise<void> => {
      const attrs = { status, ...updates, updatedAt: getTime() };
      const entries = Object.entries(attrs);
      const names: Record<string, string> = {};
      const values: Record<string, unknown> = {};
      const sets: string[] = [];
      entries.forEach(([k, v], i) => {
        names[`#a${i}`] = k;
        values[`:v${i}`] = v;
        sets.push(`#a${i} = :v${i}`);
      });
      names['#status'] = 'status';
      values[':newStatus'] = status;

      try {
        await this.docClient.send(new UpdateCommand({
          TableName: this.tableName,
          Key: { pk: `OrderMapping#${tenantId}#${nestfolioOrderId}`, sk: 'OrderMapping' },
          UpdateExpression: `SET ${sets.join(', ')}`,
          ConditionExpression: 'attribute_not_exists(#status) OR #status <> :newStatus',
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        }));
      } catch (err) {
        if ((err as Error).name === 'ConditionalCheckFailedException') return;
        throw err;
      }
    },
  );
}
