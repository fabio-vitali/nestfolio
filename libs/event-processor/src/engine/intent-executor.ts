import { PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { guardedWrite } from '../internal';
import { pickRequestContext } from '../domain/schemas';
import type { WriteIntent, RecordIntent, ProjectIntent, AccumulateIntent, UpdateIntent, StoreIntent } from '../types/write-intent';
import type { EventContext } from '../types/event-context';
import type { IntentResult } from '../types/result-types';
import { toCsv } from '../util/csv-serializer';

interface ExecutorDeps {
  docClient: DynamoDBDocumentClient;
  tableName: string;
  s3Client?: S3Client;
  bucket?: string;
}

export class IntentExecutor {
  constructor(private readonly deps: ExecutorDeps) {}

  async execute(intent: WriteIntent, ctx: EventContext): Promise<IntentResult> {
    switch (intent._tag) {
      case 'record':    return this.executeRecord(intent, ctx);
      case 'project':   return this.executeProject(intent, ctx);
      case 'accumulate': return this.executeAccumulate(intent, ctx);
      case 'update':    return this.executeUpdate(intent, ctx);
      case 'skip':      return { _tag: 'skip', success: true };
      case 'store':     return this.executeStore(intent, ctx);
      default:          return { _tag: 'unknown', success: false };
    }
  }

  private async executeRecord(intent: RecordIntent, ctx: EventContext): Promise<IntentResult> {
    const pk = intent.overrides?.pk ?? `T#${ctx.tenantId}`;
    const sk = intent.overrides?.sk ?? `${intent.typename}#${ctx.eventId}`;

    try {
      await this.deps.docClient.send(new PutCommand({
        TableName: this.deps.tableName,
        Item: { pk, sk, __typename: intent.typename, ...pickRequestContext(ctx), ...intent.fields, eventId: ctx.eventId, createdAt: ctx.timestamp },
        ConditionExpression: 'attribute_not_exists(pk)',
      }));
      return { _tag: 'record', success: true };
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        return { _tag: 'record', success: true, deduplicated: true };
      }
      throw error;
    }
  }

  private async executeProject(intent: ProjectIntent, ctx: EventContext): Promise<IntentResult> {
    const pk = intent.overrides?.pk ?? `T#${ctx.tenantId}`;
    const sk = intent.overrides?.sk ?? intent.typename;

    await this.deps.docClient.send(new PutCommand({
      TableName: this.deps.tableName,
      Item: { pk, sk, __typename: intent.typename, ...pickRequestContext(ctx), ...intent.fields, updatedAt: ctx.timestamp },
    }));
    return { _tag: 'project', success: true };
  }

  private async executeAccumulate(intent: AccumulateIntent, ctx: EventContext): Promise<IntentResult> {
    const pk = intent.overrides?.pk ?? `T#${ctx.tenantId}`;
    const sk = intent.overrides?.sk ?? intent.typename;

    // Reuse guardedWrite from lambda-utils — single source of truth for transactional dedup
    const written = await guardedWrite(
      this.deps.docClient,
      this.deps.tableName,
      { pk, sk: `ProcessedEvent#${ctx.eventId}` },
      [{
        Update: {
          TableName: this.deps.tableName,
          Key: { pk, sk },
          UpdateExpression: 'ADD #field :inc',
          ExpressionAttributeNames: { '#field': intent.field },
          ExpressionAttributeValues: { ':inc': intent.increment },
        },
      }],
      intent.ttl,
    );

    return { _tag: 'accumulate', success: true, deduplicated: !written };
  }

  private async executeUpdate(intent: UpdateIntent, ctx: EventContext): Promise<IntentResult> {
    const pk = intent.overrides?.pk ?? `T#${ctx.tenantId}`;
    const sk = intent.overrides?.sk ?? intent.typename;

    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const setParts: string[] = [];

    // Always add __typename (CDC entity resolution), request context (CDC event envelope), and updatedAt
    const allUpdates = { ...intent.updates, __typename: intent.typename, ...pickRequestContext(ctx), updatedAt: ctx.timestamp };

    let i = 0;
    for (const [field, value] of Object.entries(allUpdates)) {
      const nameKey = `#f${i}`;
      const valKey = `:v${i}`;
      names[nameKey] = field;
      values[valKey] = value;
      setParts.push(`${nameKey} = ${valKey}`);
      i++;
    }

    let updateExpr = `SET ${setParts.join(', ')}`;

    if (intent.removes && intent.removes.length > 0) {
      const removeParts = intent.removes.map((field, j) => {
        const nameKey = `#r${j}`;
        names[nameKey] = field;
        return nameKey;
      });
      updateExpr += ` REMOVE ${removeParts.join(', ')}`;
    }

    await this.deps.docClient.send(new UpdateCommand({
      TableName: this.deps.tableName,
      Key: { pk, sk },
      UpdateExpression: updateExpr,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ...(intent.condition ? { ConditionExpression: intent.condition } : {}),
    }));

    return { _tag: 'update', success: true };
  }

  private async executeStore(intent: StoreIntent, ctx: EventContext): Promise<IntentResult> {
    if (!this.deps.s3Client || !this.deps.bucket) {
      return { _tag: 'store', success: false };
    }
    const key = intent.key ?? `${ctx.serviceName}/${ctx.eventType}/${ctx.eventId}.${intent.format ?? 'json'}`;
    const body = intent.format === 'csv' && typeof intent.body !== 'string'
      ? toCsv(intent.body as Record<string, unknown>[])
      : JSON.stringify(intent.body);
    await this.deps.s3Client.send(new PutObjectCommand({
      Bucket: this.deps.bucket,
      Key: key,
      Body: body,
      ContentType: intent.format === 'csv' ? 'text/csv' : 'application/json',
    }));
    return { _tag: 'store', success: true };
  }
}
