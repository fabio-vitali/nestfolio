import { PutCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { guardedWrite, NotRetryableError } from '@nestfolio/lambda-utils';
import type { WriteIntent, RecordIntent, ProjectIntent, AccumulateIntent } from '../types/write-intent';
import type { EventContext } from '../types/event-context';
import type { IntentResult } from '../types/result-types';

interface ExecutorDeps {
  docClient: DynamoDBDocumentClient;
  tableName: string;
}

export class IntentExecutor {
  constructor(private readonly deps: ExecutorDeps) {}

  async execute(intent: WriteIntent, ctx: EventContext): Promise<IntentResult> {
    switch (intent._tag) {
      case 'record':    return this.executeRecord(intent, ctx);
      case 'project':   return this.executeProject(intent, ctx);
      case 'accumulate': return this.executeAccumulate(intent, ctx);
      case 'skip':      return { _tag: 'skip', success: true };
      case 's3-put':    throw new NotRetryableError('S3 intents require an S3 executor — use materializeToBucket pipeline');
      default:          return { _tag: 'unknown', success: false };
    }
  }

  private async executeRecord(intent: RecordIntent, ctx: EventContext): Promise<IntentResult> {
    const pk = intent.overrides?.pk ?? `T#${ctx.tenantId}`;
    const sk = intent.overrides?.sk ?? `${intent.typename}#${ctx.eventId}`;

    try {
      await this.deps.docClient.send(new PutCommand({
        TableName: this.deps.tableName,
        Item: { pk, sk, __typename: intent.typename, ...intent.fields, eventId: ctx.eventId, createdAt: ctx.timestamp },
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
      Item: { pk, sk, __typename: intent.typename, ...intent.fields, updatedAt: ctx.timestamp },
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
}
