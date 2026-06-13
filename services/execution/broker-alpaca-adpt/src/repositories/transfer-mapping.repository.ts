import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { TableRepository, getTime, withMethodLogging, type TableEntry } from '@nestfolio/event-processor';
import type { AlpacaTransferResult } from '@nestfolio/execution-adpt/domain';

export class TransferMappingRepository extends TableRepository {
  private readonly log = withMethodLogging('TransferMappingRepository');

  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

  readonly createMapping = this.log('createMapping',
    async (tenantId: string, nestfolioTransferId: string, alpacaTransferId: string, direction: string, amount: number): Promise<void> => {
      const ts = getTime();
      await this.put({
        pk: `TransferMapping#${tenantId}#${nestfolioTransferId}`,
        sk: 'TransferMapping',
        __typename: 'AlpacaTransferResult',
        tenantId,
        nestfolioTransferId,
        alpacaTransferId,
        direction: direction as AlpacaTransferResult['direction'],
        amount,
        status: 'INITIATED',
        timestamp: ts,
        createdAt: ts,
      } satisfies TableEntry<AlpacaTransferResult, { tenantId: string }> & { __typename: 'AlpacaTransferResult'; timestamp: string });
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
          Key: { pk: `TransferMapping#${tenantId}#${nestfolioTransferId}`, sk: 'TransferMapping' },
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
