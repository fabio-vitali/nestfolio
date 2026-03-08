import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';

const DEFAULT_TTL_SECONDS = 86400; // 24 hours
const MAX_RETRIES = 2;
const BACKOFF_MS = 100;

const TRANSIENT_ERROR_NAMES = new Set([
  'ThrottlingException',
  'ProvisionedThroughputExceededException',
  'InternalServerError',
]);

function isTransientError(error: unknown): boolean {
  return error instanceof Error && TRANSIENT_ERROR_NAMES.has(error.name);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Prevents duplicate event processing using DynamoDB conditional writes.
 * Each event is recorded with a TTL; if the record already exists, the event is skipped.
 */
export class IdempotencyGuard {
  private readonly ttlSeconds: number;

  constructor(
    private readonly client: DynamoDBClient,
    private readonly tableName: string,
    ttlSeconds: number = DEFAULT_TTL_SECONDS,
  ) {
    this.ttlSeconds = ttlSeconds;
  }

  /**
   * Attempts to mark an event as processed.
   * @returns `true` if this is the first time (proceed), `false` if already processed (skip).
   * @throws Re-throws any DynamoDB error that is not a ConditionalCheckFailedException.
   *         Retries transient errors (ThrottlingException, ProvisionedThroughputExceededException,
   *         InternalServerError) up to 2 times with 100ms backoff.
   */
  async ensureOnce(eventType: string, eventId: string): Promise<boolean> {
    const key = `${eventType}#${eventId}`;
    const ttl = Math.floor(Date.now() / 1000) + this.ttlSeconds;

    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
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

        if (isTransientError(error) && attempt < MAX_RETRIES) {
          lastError = error;
          await sleep(BACKOFF_MS * (attempt + 1));
          continue;
        }

        throw error;
      }
    }

    // Retries exhausted — throw original error
    throw lastError;
  }
}
