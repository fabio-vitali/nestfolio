import { DynamoDBClient, GetItemCommand, QueryCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall, marshall } from '@aws-sdk/util-dynamodb';
import type { IntegrationContext } from '../context';

export class TableAssertions {
  private readonly client: DynamoDBClient;
  private readonly ctx: IntegrationContext;
  private readonly observed: { tableName: string; pk: string; sk: string }[] = [];
  private cleanupRegistered = false;

  constructor(ctx: IntegrationContext) {
    this.ctx = ctx;
    this.client = new DynamoDBClient({ region: ctx.region });
    this.registerCleanup();
  }

  /**
   * Register auto-cleanup of all items observed via waitForItem/assertItem.
   * Safe to call multiple times — idempotent via cleanupRegistered guard.
   */
  registerCleanup(): void {
    if (this.cleanupRegistered) return;
    this.cleanupRegistered = true;
    this.ctx.cleanup.register('TableAssertions', () => this.cleanupAll());
  }

  private async cleanupAll(): Promise<void> {
    for (const { tableName, pk, sk } of this.observed) {
      try {
        await this.client.send(new DeleteItemCommand({
          TableName: tableName,
          Key: marshall({ pk, sk }),
        }));
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`TableAssertions cleanup: failed to delete pk=${pk} sk=${sk}`, err);
      }
    }
    this.client.destroy();
  }

  async waitForItem(params: {
    table: string;
    pk: string;
    sk?: string;
    timeoutMs?: number;
    pollIntervalMs?: number;
  }): Promise<Record<string, unknown>> {
    const timeout = params.timeoutMs ?? this.ctx.timings.eventTimeout;
    const pollInterval = params.pollIntervalMs ?? this.ctx.timings.pollInterval;
    const deadline = Date.now() + timeout;
    const tableName = await this.ctx.ssm.tableName(params.table);

    while (Date.now() < deadline) {
      if (params.sk) {
        const result = await this.client.send(new GetItemCommand({
          TableName: tableName,
          Key: marshall({ pk: params.pk, sk: params.sk }),
        }));
        if (result.Item) {
          const item = unmarshall(result.Item);
          this.observed.push({ tableName, pk: item['pk'] as string, sk: item['sk'] as string });
          return item;
        }
      } else {
        const result = await this.client.send(new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: marshall({ ':pk': params.pk }),
          Limit: 1,
        }));
        if (result.Items?.length) {
          const item = unmarshall(result.Items[0]);
          this.observed.push({ tableName, pk: item['pk'] as string, sk: item['sk'] as string });
          return item;
        }
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error(`TableAssertions: timeout waiting for item pk=${params.pk} sk=${params.sk ?? '(any)'} in ${params.table} after ${timeout}ms`);
  }

  async queryItems(params: {
    table: string;
    pk: string;
    skPrefix?: string;
  }): Promise<Record<string, unknown>[]> {
    const tableName = await this.ctx.ssm.tableName(params.table);
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
    const tableName = await this.ctx.ssm.tableName(params.table);

    for (const item of items) {
      await this.client.send(new DeleteItemCommand({
        TableName: tableName,
        Key: marshall({ pk: item['pk'], sk: item['sk'] }),
      }));
    }
  }
}
