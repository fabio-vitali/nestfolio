import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import type { IntegrationContext } from '../context';

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
  private readonly ctx: IntegrationContext;

  constructor(ctx: IntegrationContext) {
    this.ctx = ctx;
    this.client = new DynamoDBClient({ region: ctx.region });
  }

  async seed(serviceName: string, options?: AccountSeedOptions): Promise<void> {
    const tableName = await this.ctx.ssm.tableName(serviceName);
    const streamType = options?.streamType ?? 'actual';
    const pk = `Account#${this.ctx.tenantId}#${streamType}`;
    const now = new Date().toISOString();

    const item = {
      pk,
      sk: 'Snapshot#latest',
      __typename: 'AccountSnapshot',
      tenantId: this.ctx.tenantId,
      timestamp: now,
      streamType,
      positions: options?.positions ?? {},
      cashBalanceCents: options?.cashBalanceCents ?? 1_000_000,
      totalValueCents: options?.cashBalanceCents ?? 1_000_000,
      positionCount: Object.keys(options?.positions ?? {}).length,
      lastEventSequence: 0,
      version: 1,
      snapshotAt: now,
    };

    await this.client.send(new PutItemCommand({
      TableName: tableName,
      Item: marshall(item, { removeUndefinedValues: true }),
    }));
  }
}
