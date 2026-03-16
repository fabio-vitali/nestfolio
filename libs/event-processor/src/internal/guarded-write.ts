import { DynamoDBDocumentClient, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';

const DEFAULT_TTL_SECONDS = 86400; // 24 hours

/**
 * Atomically writes a guard marker + business operations in a single DynamoDB transaction.
 * If the guard marker already exists (duplicate event), returns false and skips the business writes.
 *
 * Used for additive operations (ADD/increment) where replaying doubles the effect.
 *
 * @param guardKey - pk/sk for the guard marker. Use the business entity's pk + `ProcessedEvent#${eventId}` sk.
 * @param transactItems - The business operations to execute atomically with the guard.
 * @param ttlSeconds - TTL for the guard marker (default 24h; use 604800 for financial operations).
 * @returns true if the transaction succeeded (first time), false if guard marker exists (duplicate).
 */
export async function guardedWrite(
  docClient: DynamoDBDocumentClient,
  tableName: string,
  guardKey: { pk: string; sk: string },
  transactItems: Record<string, unknown>[],
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<boolean> {
  try {
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: tableName,
              Item: {
                ...guardKey,
                __typename: 'ProcessedEvent',
                ttl: Math.floor(Date.now() / 1000) + ttlSeconds,
              },
              ConditionExpression: 'attribute_not_exists(pk)',
            },
          },
          ...transactItems,
        ],
      }),
    );
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'TransactionCanceledException') {
      const reasons = (error as any).CancellationReasons as Array<{ Code?: string }> | undefined;
      if (reasons?.[0]?.Code === 'ConditionalCheckFailed') {
        return false; // guard marker exists — skip
      }
    }
    throw error;
  }
}
