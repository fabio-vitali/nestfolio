import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { TableRepository, getTime, withMethodLogging } from '@nestfolio/event-processor';

export class CircuitBreakerRepository extends TableRepository {
  private readonly log = withMethodLogging('CircuitBreakerRepository');

  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

  readonly getBreaker = this.log('getBreaker',
    async (tenantId: string, symbol: string): Promise<Record<string, unknown> | null> => {
      const result = await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: {
            pk: `CircuitBreaker#${tenantId}#${symbol}`,
            sk: 'CircuitBreaker',
          },
        }),
      );
      return result.Item ?? null;
    },
  );

  readonly openBreaker = this.log('openBreaker',
    async (tenantId: string, symbol: string, reason: string): Promise<void> => {
      await this.put({
        pk: `CircuitBreaker#${tenantId}#${symbol}`,
        sk: 'CircuitBreaker',
        __typename: 'CircuitBreaker',
        tenantId,
        symbol,
        state: 'OPEN',
        openedAt: getTime(),
        reason,
      });
    },
  );

  readonly closeBreaker = this.log('closeBreaker',
    async (tenantId: string, symbol: string): Promise<void> => {
      await this.update(
        `CircuitBreaker#${tenantId}#${symbol}`,
        'CircuitBreaker',
        { state: 'CLOSED', closedAt: getTime() },
      );
    },
  );

  readonly isOpen = this.log('isOpen',
    async (tenantId: string, symbol: string): Promise<boolean> => {
      const breaker = await this.getBreaker(tenantId, symbol);
      return breaker?.state === 'OPEN';
    },
  );

  readonly storeHealTaskToken = this.log('storeHealTaskToken',
    async (tenantId: string, symbol: string, healTaskToken: string): Promise<void> => {
      await this.update(
        `CircuitBreaker#${tenantId}#${symbol}`,
        'CircuitBreaker',
        { healTaskToken },
      );
    },
  );
}
