import type { DynamoDBStreamEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { StreamRecord, StreamContext } from '../types/stream-types';
import type { WriteIntent, RecordIntent } from '../types/write-intent';
import type { EventContext } from '../types/event-context';
import { EgestionEngine } from '../engine/egestion-engine';
import { IntentExecutor } from '../engine/intent-executor';
import { logger, getUUID } from '../internal';
import { asTenantId, asUserId } from '../platform/types/branded';

export interface DeriveFromStreamConfig {
  serviceName: string;
  /** Filter stream records (e.g., by __typename). */
  filter?: (record: StreamRecord) => boolean;
  /**
   * Transform a stream record into WriteIntents.
   * `previous` is the OldImage (undefined on INSERT).
   */
  transform: (
    current: StreamRecord,
    previous: StreamRecord | undefined,
    ctx: StreamContext,
  ) => WriteIntent[] | Promise<WriteIntent[]>;
  table?: string;
  bus?: string;
  concurrency?: number;
  errorEventType?: string;
}

export function deriveFromStream(
  config: DeriveFromStreamConfig,
): (event: DynamoDBStreamEvent) => Promise<void> {
  const tableName = config.table ?? process.env.TABLE_NAME!;
  const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const executorDeps = { docClient, tableName };

  const processRecord = async (record: StreamRecord, ctx: StreamContext): Promise<void> => {
    const previous = ctx.oldImage as StreamRecord | undefined;
    const intents = await Promise.resolve(config.transform(record, previous, ctx));

    if (intents.length === 0) return;

    const executor = new IntentExecutor(executorDeps);

    for (const intent of intents) {
      const eventCtx: EventContext = {
        eventId: `derived-${getUUID()}`,
        eventType: intent._tag === 'record' ? (intent as RecordIntent).typename : 'DERIVED',
        tenantId: asTenantId(record.tenantId ?? ''),
        userId: asUserId(record.userId ?? 'system'),
        region: record.region ?? process.env['AWS_REGION'] ?? 'us-east-1',
        timestamp: new Date().toISOString(),
        serviceName: config.serviceName,
        record: ctx.record,
      };

      await executor.execute(intent, eventCtx);
    }

    logger.info('Derived intents written', {
      eventID: ctx.record.eventID,
      intentCount: intents.length,
    });
  };

  const busName = config.bus ?? process.env.BUS_NAME;

  const engine = new EgestionEngine({
    serviceName: config.serviceName,
    filter: config.filter,
    processRecord,
    concurrency: config.concurrency,
    busName,
    errorEventType: config.errorEventType,
  });

  return (event: DynamoDBStreamEvent) => engine.process(event);
}
