import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  type QueryCommandInput,
  type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { log } from '../logger';

/**
 * Abstract base class for DynamoDB table repositories.
 * Provides standard operations: put, query (with auto-pagination), transact write.
 * Concrete repositories extend this with domain-specific methods.
 */
export abstract class TableRepository {
  protected readonly docClient: DynamoDBDocumentClient;

  constructor(
    protected readonly tableName: string,
    client?: DynamoDBClient,
  ) {
    this.docClient = DynamoDBDocumentClient.from(client ?? new DynamoDBClient({}));
  }

  @log()
  protected async put(item: Record<string, unknown>): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
      }),
    );
  }

  @log()
  protected async queryByPk(pk: string, skPrefix?: string): Promise<Record<string, unknown>[]> {
    const params: QueryCommandInput = {
      TableName: this.tableName,
      KeyConditionExpression: skPrefix ? 'pk = :pk AND begins_with(sk, :sk)' : 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': pk,
        ...(skPrefix ? { ':sk': skPrefix } : {}),
      },
    };
    return this.queryAll(params);
  }

  @log()
  protected async queryAll<T = Record<string, unknown>>(input: QueryCommandInput): Promise<T[]> {
    const items: T[] = [];
    let lastKey: Record<string, unknown> | undefined = undefined;

    do {
      const params: QueryCommandInput = { ...input };
      if (lastKey) params.ExclusiveStartKey = lastKey;
      const result = await this.docClient.send(new QueryCommand(params));
      items.push(...((result.Items ?? []) as T[]));
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    return items;
  }

  @log()
  protected async transactWrite(input: TransactWriteCommandInput): Promise<void> {
    await this.docClient.send(new TransactWriteCommand(input));
  }
}
