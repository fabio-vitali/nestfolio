import { DynamoDBClient, GetItemCommand, QueryCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall, marshall } from '@aws-sdk/util-dynamodb';
import { jitter, createTestAwsClient } from '@nestfolio/test-support';
import type { TestContext } from '@nestfolio/test-support';

export class TableAssertions {
  private readonly client: DynamoDBClient;
  private readonly ctx: TestContext;
  private readonly observed: { tableName: string; pk: string; sk: string }[] = [];
  private cleanupRegistered = false;

  constructor(ctx: TestContext) {
    this.ctx = ctx;
    this.client = createTestAwsClient(DynamoDBClient, ctx.region);
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

  async waitForItem<T extends Record<string, unknown> = Record<string, unknown>>(params: {
    table: string;
    pk: string;
    sk?: string;
    timeoutMs?: number;
    pollIntervalMs?: number;
    match?: Partial<T>;
    predicate?: (item: T) => boolean;
    description?: string;
  }): Promise<T> {
    const timeout = params.timeoutMs ?? this.ctx.timings.eventTimeout;
    const pollInterval = params.pollIntervalMs ?? this.ctx.timings.pollInterval;
    const deadline = Date.now() + timeout;
    const tableName = await this.ctx.ssm.tableName(params.table);

    let lastObserved: T | undefined;

    while (Date.now() < deadline) {
      let item: T | undefined;

      if (params.sk) {
        const result = await this.client.send(new GetItemCommand({
          TableName: tableName,
          Key: marshall({ pk: params.pk, sk: params.sk }),
        }));
        if (result.Item) item = unmarshall(result.Item) as T;
      } else {
        const result = await this.client.send(new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: marshall({ ':pk': params.pk }),
          Limit: 1,
        }));
        if (result.Items?.length) item = unmarshall(result.Items[0]) as T;
      }

      if (item) {
        lastObserved = item;
        const matchOk = !params.match || Object.entries(params.match as Record<string, unknown>).every(([k, v]) => item![k] === v);
        const predicateOk = !params.predicate || params.predicate(item);
        if (matchOk && predicateOk) {
          this.observed.push({ tableName, pk: item['pk'] as string, sk: item['sk'] as string });
          return item;
        }
      }

      await new Promise(resolve => setTimeout(resolve, jitter(pollInterval)));
    }

    const matchDesc = params.match ? ` match=${JSON.stringify(params.match)}` : '';
    const predDesc = params.predicate ? ` predicate: "${params.description ?? '(unlabeled)'}"` : '';
    const lastDesc = lastObserved ? JSON.stringify(lastObserved) : '(never observed)';
    throw new Error(
      `TableAssertions: timeout waiting for item pk=${params.pk} sk=${params.sk ?? '(any)'}${matchDesc}${predDesc} in ${params.table} after ${timeout}ms. Last item: ${lastDesc}`
    );
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
