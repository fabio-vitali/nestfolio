import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { TableRepository, getTime, withMethodLogging } from '@nestfolio/event-processor';

export class ExecutionModeRepository extends TableRepository {
  private readonly log = withMethodLogging('ExecutionModeRepository');

  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

  readonly upsertMode = this.log('upsertMode',
    async (tenantId: string, mode: 'simulation' | 'live'): Promise<void> => {
      await this.put({
        pk: `ExecutionMode#${tenantId}`,
        sk: 'ExecutionMode',
        __typename: 'ExecutionMode',
        tenantId,
        mode,
        updatedAt: getTime(),
      });
    },
  );

  readonly getMode = this.log('getMode',
    async (tenantId: string): Promise<'simulation' | 'live'> => {
      const result = await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { pk: `ExecutionMode#${tenantId}`, sk: 'ExecutionMode' },
        }),
      );
      return (result.Item?.mode as 'simulation' | 'live') ?? 'simulation';
    },
  );
}
