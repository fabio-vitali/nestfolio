import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { TableRepository, getTime, withMethodLogging } from '@nestfolio/event-processor';

export class CircuitBreakerRepository extends TableRepository {
  private readonly log = withMethodLogging('CircuitBreakerRepository');

  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

  readonly isOpen = this.log('isOpen',
    async (adapterId: string): Promise<boolean> => {
      const result = await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: {
            pk: `CircuitBreaker#${adapterId}`,
            sk: 'CircuitBreaker',
          },
        }),
      );
      return result.Item?.state === 'OPEN';
    },
  );

  readonly open = this.log('open',
    async (adapterId: string, reason: string): Promise<boolean> => {
      try {
        await this.docClient.send(
          new PutCommand({
            TableName: this.tableName,
            Item: {
              pk: `CircuitBreaker#${adapterId}`,
              sk: 'CircuitBreaker',
              __typename: 'CircuitBreaker',
              state: 'OPEN',
              adapter: adapterId,
              openedAt: getTime(),
              reason,
            },
            ConditionExpression: 'attribute_not_exists(pk) OR #st <> :open',
            ExpressionAttributeNames: { '#st': 'state' },
            ExpressionAttributeValues: { ':open': 'OPEN' },
          }),
        );
        return true;
      } catch (err: unknown) {
        if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
          return false;
        }
        throw err;
      }
    },
  );

  readonly close = this.log('close',
    async (adapterId: string): Promise<void> => {
      await this.update(
        `CircuitBreaker#${adapterId}`,
        'CircuitBreaker',
        { state: 'CLOSED', closedAt: getTime() },
      );
    },
  );

  readonly writeBreakerOpenEvent = this.log('writeBreakerOpenEvent',
    async (tenantId: string): Promise<void> => {
      const timestamp = getTime();
      await this.put({
        pk: `NormalizedEvent#${tenantId}#CIRCUIT_BREAKER`,
        sk: `BROKER_CIRCUIT_OPEN#${timestamp}`,
        __typename: 'NormalizedEvent',
        tenantId,
        timestamp,
      });
    },
  );
}
