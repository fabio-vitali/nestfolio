import { DynamoDBClient, PutItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import type { TestContext } from '@nestfolio/test-support';

export class DdbSeedFixture {
  private readonly client: DynamoDBClient;
  private readonly ctx: TestContext;
  private readonly seeded: { tableName: string; pk: string; sk: string }[] = [];

  constructor(ctx: TestContext) {
    this.ctx = ctx;
    this.client = new DynamoDBClient({ region: ctx.region });
    this.ctx.cleanup.register('DdbSeedFixture', () => this.teardown());
  }

  async seed(params: { table: string; items: Record<string, unknown>[] }): Promise<void> {
    const tableName = await this.ctx.ssm.tableName(params.table);

    for (const item of params.items) {
      const pk = item['pk'] as string;
      const sk = item['sk'] as string;
      if (!pk || !sk) throw new Error('DdbSeedFixture: seeded items must have pk and sk');

      await this.client.send(new PutItemCommand({
        TableName: tableName,
        Item: marshall(item, { removeUndefinedValues: true }),
      }));
      this.seeded.push({ tableName, pk, sk });
    }
  }

  private async teardown(): Promise<void> {
    for (const { tableName, pk, sk } of this.seeded) {
      try {
        await this.client.send(new DeleteItemCommand({
          TableName: tableName,
          Key: marshall({ pk, sk }),
        }));
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`DdbSeedFixture: failed to delete pk=${pk} sk=${sk}`, err);
      }
    }
  }
}
