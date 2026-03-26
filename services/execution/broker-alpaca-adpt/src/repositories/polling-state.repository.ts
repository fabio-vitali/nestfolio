import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { TableRepository, withMethodLogging } from '@nestfolio/event-processor';

export class PollingStateRepository extends TableRepository {
  private readonly log = withMethodLogging('PollingStateRepository');

  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

  readonly getState = this.log('getState',
    async (tenantId: string): Promise<Record<string, unknown> | null> => {
      const result = await this.docClient.send(new GetCommand({
        TableName: this.tableName,
        Key: { pk: `PollingState#${tenantId}`, sk: 'PollingState' },
      }));
      return result.Item ?? null;
    },
  );

  readonly updateLastCheckedAt = this.log('updateLastCheckedAt',
    async (tenantId: string, lastCheckedAt: string): Promise<void> => {
      await this.update(`PollingState#${tenantId}`, 'PollingState', { lastCheckedAt });
    },
  );

  readonly incrementOpenOrderCount = this.log('incrementOpenOrderCount',
    async (tenantId: string): Promise<void> => {
      await this.docClient.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: `PollingState#${tenantId}`, sk: 'PollingState' },
        UpdateExpression: 'ADD openOrderCount :inc SET __typename = :tn',
        ExpressionAttributeValues: { ':inc': 1, ':tn': 'PollingState' },
      }));
    },
  );

  readonly decrementOpenOrderCount = this.log('decrementOpenOrderCount',
    async (tenantId: string): Promise<void> => {
      await this.docClient.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: `PollingState#${tenantId}`, sk: 'PollingState' },
        UpdateExpression: 'ADD openOrderCount :dec',
        ExpressionAttributeValues: { ':dec': -1 },
      }));
    },
  );
}
