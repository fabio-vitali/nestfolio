import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { TableRepository, getTime, withMethodLogging } from '@nestfolio/event-processor';

export class TransferMappingRepository extends TableRepository {
  private readonly log = withMethodLogging('TransferMappingRepository');

  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

  readonly createMapping = this.log('createMapping',
    async (tenantId: string, nestfolioTransferId: string, alpacaTransferId: string, direction: string, amount: number): Promise<void> => {
      await this.put({
        pk: `TransferMapping#${tenantId}#${nestfolioTransferId}`,
        sk: 'TransferMapping',
        __typename: 'AlpacaTransferResult',
        tenantId,
        nestfolioTransferId,
        alpacaTransferId,
        direction,
        amount,
        status: 'INITIATED',
        timestamp: getTime(),
      });
    },
  );

  readonly getPendingTransfers = this.log('getPendingTransfers',
    async (tenantId: string): Promise<Record<string, unknown>[]> => {
      return this.queryAll({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk',
        FilterExpression: '#status = :pending',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':pk': `PendingTransfers#${tenantId}`, ':pending': 'INITIATED' },
      });
    },
  );

  readonly updateStatus = this.log('updateStatus',
    async (tenantId: string, nestfolioTransferId: string, status: string, updates: Record<string, unknown> = {}): Promise<void> => {
      await this.update(
        `TransferMapping#${tenantId}#${nestfolioTransferId}`,
        'TransferMapping',
        { status, ...updates, updatedAt: getTime() },
      );
    },
  );
}
