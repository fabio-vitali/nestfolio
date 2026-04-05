import { DynamoDBClient, GetItemCommand, QueryCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall, marshall } from '@aws-sdk/util-dynamodb';
import type { IntegrationContext } from '../context';

export class TableAssertions {
  private readonly client: DynamoDBClient;
  private readonly ctx: IntegrationContext;

  constructor(ctx: IntegrationContext) {
    this.ctx = ctx;
    this.client = new DynamoDBClient({ region: ctx.region });
  }

  async waitForItem(params: {
    table: string;
    pk: string;
    sk?: string;
    timeoutMs?: number;
    pollIntervalMs?: number;
  }): Promise<Record<string, unknown>> {
    const timeout = params.timeoutMs ?? 30_000;
    const pollInterval = params.pollIntervalMs ?? 2_000;
    const deadline = Date.now() + timeout;
    const tableName = this.ctx.ssm.tableName(params.table);

    while (Date.now() < deadline) {
      if (params.sk) {
        const result = await this.client.send(new GetItemCommand({
          TableName: tableName,
          Key: marshall({ pk: params.pk, sk: params.sk }),
        }));
        if (result.Item) return unmarshall(result.Item);
      } else {
        const result = await this.client.send(new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: marshall({ ':pk': params.pk }),
          Limit: 1,
        }));
        if (result.Items?.length) return unmarshall(result.Items[0]);
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error(`TableAssertions: timeout waiting for item pk=${params.pk} sk=${params.sk ?? '(any)'} in ${params.table} after ${timeout}ms`);
  }

  async assertItem(params: {
    table: string;
    pk: string;
    sk: string;
    expect: Record<string, unknown>;
  }): Promise<void> {
    const tableName = this.ctx.ssm.tableName(params.table);
    const result = await this.client.send(new GetItemCommand({
      TableName: tableName,
      Key: marshall({ pk: params.pk, sk: params.sk }),
    }));

    if (!result.Item) {
      throw new Error(`TableAssertions: item not found pk=${params.pk} sk=${params.sk}`);
    }

    const item = unmarshall(result.Item);
    for (const [key, expectedValue] of Object.entries(params.expect)) {
      if (item[key] !== expectedValue) {
        throw new Error(`TableAssertions: expected ${key}=${JSON.stringify(expectedValue)}, got ${JSON.stringify(item[key])}`);
      }
    }
  }

  async queryItems(params: {
    table: string;
    pk: string;
    skPrefix?: string;
  }): Promise<Record<string, unknown>[]> {
    const tableName = this.ctx.ssm.tableName(params.table);
    const keyCondition = params.skPrefix
      ? 'pk = :pk AND begins_with(sk, :skPrefix)'
      : 'pk = :pk';
    const exprValues: Record<string, unknown> = { ':pk': params.pk };
    if (params.skPrefix) exprValues[':skPrefix'] = params.skPrefix;

    const result = await this.client.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: keyCondition,
      ExpressionAttributeValues: marshall(exprValues),
    }));

    return (result.Items ?? []).map(item => unmarshall(item));
  }

  async cleanup(params: { table: string; pk: string }): Promise<void> {
    const items = await this.queryItems({ table: params.table, pk: params.pk });
    const tableName = this.ctx.ssm.tableName(params.table);

    for (const item of items) {
      await this.client.send(new DeleteItemCommand({
        TableName: tableName,
        Key: marshall({ pk: item['pk'], sk: item['sk'] }),
      }));
    }
  }
}
