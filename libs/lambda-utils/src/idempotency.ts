import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';

const IDEMPOTENCY_TTL_SECONDS = 86400; // 24 hours

/**
 * Prevents duplicate event processing using DynamoDB conditional writes.
 * Each event is recorded with a TTL; if the record already exists, the event is skipped.
 */
export class IdempotencyGuard {
  constructor(
    private readonly client: DynamoDBClient,
    private readonly tableName: string,
  ) {}

  /**
   * Attempts to mark an event as processed.
   * @returns `true` if this is the first time (proceed), `false` if already processed (skip).
   * @throws Re-throws any DynamoDB error that is not a ConditionalCheckFailedException.
   */
  async ensureOnce(eventType: string, eventId: string): Promise<boolean> {
    const key = `${eventType}#${eventId}`;
    const ttl = Math.floor(Date.now() / 1000) + IDEMPOTENCY_TTL_SECONDS;

    try {
      await this.client.send(
        new PutItemCommand({
          TableName: this.tableName,
          Item: {
            pk: { S: `Idempotency#${key}` },
            sk: { S: 'Processed' },
            processedAt: { S: new Date().toISOString() },
            ttl: { N: ttl.toString() },
          },
          ConditionExpression: 'attribute_not_exists(pk)',
        }),
      );
      return true; // First time — proceed
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.name === 'ConditionalCheckFailedException'
      ) {
        return false; // Already processed — skip
      }
      throw error;
    }
  }
}
