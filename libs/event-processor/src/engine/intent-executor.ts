import { PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { guardedWrite, RetryablePreconditionError } from '../internal';
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

/**
 * Deep-strip undefined values from intent payloads before they reach the
 * DDB DocumentClient marshaller. The default marshaller throws
 * `Pass options.removeUndefinedValues=true to remove undefined values`
 * on any undefined leaf. Handlers commonly produce undefined fields when
 * upstream rows omit optional columns (e.g. MandateSnapshot.status before
 * MANDATE_REVOKED writes it). Treat undefined uniformly as absent — that
 * is the platform contract callers reasonably expect.
 *
 * Why not pass marshallOptions.removeUndefinedValues to the DocumentClient
 * directly: that affects ExpressionAttributeValues for UpdateCommand too,
 * where stripping a value would leave an orphan SET placeholder. Stripping
 * at this boundary keeps the policy local to record/project Items.
 */
function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => stripUndefinedDeep(v)) as unknown as T;
  }
  if (value && typeof value === 'object' && value.constructor === Object) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = stripUndefinedDeep(v);
    }
    return out as T;
  }
  return value;
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
      const item = stripUndefinedDeep({ pk, sk, __typename: intent.typename, ...pickRequestContext(ctx), ...intent.fields, eventId: ctx.eventId, createdAt: ctx.timestamp });
      await this.deps.docClient.send(new PutCommand({
        TableName: this.deps.tableName,
        Item: item,
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

    const item = stripUndefinedDeep({ pk, sk, __typename: intent.typename, ...pickRequestContext(ctx), ...intent.fields, updatedAt: ctx.timestamp });
    await this.deps.docClient.send(new PutCommand({
      TableName: this.deps.tableName,
      Item: item,
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

    // Always add __typename (CDC entity resolution), request context (CDC event envelope), and updatedAt.
    // Strip undefined leaves recursively — same contract as record/project paths;
    // a top-level undefined value is treated as "do not write this field" rather
    // than emitting a SET placeholder that would crash the DDB marshaller.
    const allUpdates = stripUndefinedDeep({ ...intent.updates, __typename: intent.typename, ...pickRequestContext(ctx), updatedAt: ctx.timestamp }) as Record<string, unknown>;

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

    if (intent.conditionNames) Object.assign(names, intent.conditionNames);
    if (intent.conditionValues) Object.assign(values, intent.conditionValues);

    try {
      await this.deps.docClient.send(new UpdateCommand({
        TableName: this.deps.tableName,
        Key: { pk, sk },
        UpdateExpression: updateExpr,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ...(intent.condition ? { ConditionExpression: intent.condition } : {}),
      }));
      return { _tag: 'update', success: true };
    } catch (error: unknown) {
      // ConditionalCheckFailedException semantics depend on the caller's
      // policy:
      //
      // - `onConditionFail: 'retry'` (set via updateOrRetry()) — throw a
      //   RetryablePreconditionError so isRetryable() returns true and SQS
      //   redrives. We cannot re-throw the original SDK error: it carries
      //   `$fault: 'client'` which isRetryable() classifies as terminal,
      //   so the redrive never fires.
      // - `onConditionFail: 'skip'` or undefined (the default via the
      //   `update()` factory) — return `{ success: true, deduplicated:
      //   true }`. Matches executeRecord's putIfNotExists dedup pattern;
      //   callers express "skip if pre-condition not met" via `condition`
      //   without reading and branching themselves.
      if (intent.condition && error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        if (intent.onConditionFail === 'retry') {
          throw new RetryablePreconditionError(intent.condition, error);
        }
        return { _tag: 'update', success: true, deduplicated: true };
      }
      throw error;
    }
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
