import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { TableRepository, getTime, withMethodLogging } from '@nestfolio/event-processor';

export class OrderMappingRepository extends TableRepository {
  private readonly log = withMethodLogging('OrderMappingRepository');

  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

  readonly createMapping = this.log('createMapping',
    async (tenantId: string, nestfolioOrderId: string, alpacaOrderId: string, symbol: string, side: string, qty: number): Promise<void> => {
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
        timestamp: getTime(),
      });
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
      await this.update(
        `OrderMapping#${tenantId}#${nestfolioOrderId}`,
        'OrderMapping',
        { status, ...updates, updatedAt: getTime() },
      );
    },
  );
}
