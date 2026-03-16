import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  TransactWriteCommand,
  type QueryCommandInput,
  type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { log } from '../logger';

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
  protected async putIfNotExists(item: Record<string, unknown>): Promise<boolean> {
    try {
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: 'attribute_not_exists(pk)',
        }),
      );
      return true;
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        return false;
      }
      throw error;
    }
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
  protected async update(pk: string, sk: string, attrs: Record<string, unknown>): Promise<void> {
    const { expression, names, values } = TableRepository.buildUpdateExpression(attrs);
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk, sk },
        UpdateExpression: expression,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }),
    );
  }

  protected buildTransactUpdate(
    pk: string,
    sk: string,
    attrs: Record<string, unknown>,
  ): { Update: Record<string, unknown> } {
    const { expression, names, values } = TableRepository.buildUpdateExpression(attrs);
    return {
      Update: {
        TableName: this.tableName,
        Key: { pk, sk },
        UpdateExpression: expression,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      },
    };
  }

  static buildUpdateExpression(attrs: Record<string, unknown>): {
    expression: string;
    names: Record<string, string>;
    values: Record<string, unknown>;
  } {
    const entries = Object.entries(attrs);
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const setClauses: string[] = [];

    for (let i = 0; i < entries.length; i++) {
      const [key, value] = entries[i];
      names[`#a${i}`] = key;
      values[`:v${i}`] = value;
      setClauses.push(`#a${i} = :v${i}`);
    }

    return {
      expression: `SET ${setClauses.join(', ')}`,
      names,
      values,
    };
  }

  @log()
  protected async transactWrite(input: TransactWriteCommandInput): Promise<void> {
    await this.docClient.send(new TransactWriteCommand(input));
  }
}
