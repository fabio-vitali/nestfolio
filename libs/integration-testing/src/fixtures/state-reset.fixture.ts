import { DynamoDBClient, QueryCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { createTestAwsClient, type TestContext } from '@nestfolio/test-support';

export class StateResetFixture {
  private readonly client: DynamoDBClient;
  private readonly ctx: TestContext;

  constructor(ctx: TestContext) {
    this.ctx = ctx;
    this.client = createTestAwsClient(DynamoDBClient, ctx.region);
  }

  async reset(entries: Array<{ table: string; pk: string }>): Promise<void> {
    for (const { table, pk } of entries) {
      try {
        const tableName = await this.ctx.ssm.tableName(table);
        const result = await this.client.send(new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: marshall({ ':pk': pk }),
        }));

        for (const item of result.Items ?? []) {
          const { pk: itemPk, sk } = unmarshall(item);
          await this.client.send(new DeleteItemCommand({
            TableName: tableName,
            Key: marshall({ pk: itemPk, sk }),
          }));
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`StateResetFixture: failed to reset pk=${pk} in ${table}`, err);
      }
    }
  }
}
