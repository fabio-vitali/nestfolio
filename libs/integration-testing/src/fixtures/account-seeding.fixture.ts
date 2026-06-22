import { DynamoDBClient, PutItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { createTestAwsClient, type TestContext } from '@nestfolio/test-support';

export interface AccountSeedOptions {
  readonly cashBalanceCents?: number;
  readonly positions?: Record<string, { symbol: string; quantity: number; averageCostBasis: number; totalCostBasis: number; lastFillPrice: number }>;
  readonly streamType?: 'actual' | 'simulated';
}

/**
 * Seeds an initial AccountSnapshot into DDB so the Reducer has prior state
 * to delta against when computing BalanceEvent / PortfolioEvent records.
 */
export class AccountSeedingFixture {
  private readonly client: DynamoDBClient;
  private readonly ctx: TestContext;
  private readonly seededItems: { tableName: string; pk: string; sk: string }[] = [];

  constructor(ctx: TestContext) {
    this.ctx = ctx;
    this.client = createTestAwsClient(DynamoDBClient, ctx.region);
    ctx.cleanup.register('AccountSeedingFixture', async () => {
      for (const { tableName, pk, sk } of this.seededItems.reverse()) {
        try {
          await this.client.send(new DeleteItemCommand({
            TableName: tableName,
            Key: marshall({ pk, sk }),
          }));
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(`AccountSeedingFixture cleanup failed: pk=${pk} sk=${sk}`, err);
        }
      }
      this.client.destroy();
    });
  }

  async seed(serviceName: string, options?: AccountSeedOptions): Promise<void> {
    const tableName = await this.ctx.ssm.tableName(serviceName);
    const streamType = options?.streamType ?? 'actual';
    const pk = `Account#${this.ctx.tenantId}#${streamType}`;
    const sk = 'Snapshot#latest';
    const now = new Date().toISOString();

    const item = {
      pk,
      sk,
      __typename: 'AccountSnapshot',
      tenantId: this.ctx.tenantId,
      timestamp: now,
      streamType,
      positions: options?.positions ?? {},
      cashBalanceCents: options?.cashBalanceCents ?? 1_000_000,
      totalValueCents: options?.cashBalanceCents ?? 1_000_000,
      positionCount: Object.keys(options?.positions ?? {}).length,
      lastEventSequence: 0,
      snapshotAt: now,
    };

    await this.client.send(new PutItemCommand({
      TableName: tableName,
      Item: marshall(item, { removeUndefinedValues: true }),
    }));

    this.seededItems.push({ tableName, pk, sk });
  }
}
