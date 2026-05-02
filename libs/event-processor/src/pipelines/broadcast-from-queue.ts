import type {
  SQSEvent,
  SQSHandler,
  SQSBatchResponse,
  SQSBatchItemFailure,
  SQSRecord,
} from 'aws-lambda';
import { logger } from '../internal';
import type { EventPayload } from '../types/handler-config';
import type { EventContext } from '../types/event-context';
import { postAppSyncMutation } from '../shared/post-appsync-mutation';

export interface QueueBroadcastEntry {
  mutation: string;
  /**
   * Returns either a single variables object (one mutation per event) or an
   * array (multiple mutations per event — e.g. one inbound BROKER_CIRCUIT_OPEN
   * fans out to three feature-flag mutations).
   */
  mapPayload: (
    payload: EventPayload,
    ctx: EventContext,
  ) => Record<string, unknown> | Record<string, unknown>[];
}

export interface BroadcastFromQueueConfig {
  serviceName: string;
  appsyncUrl: string;
  region?: string;
  /** Keyed by event detail-type. */
  broadcasts: Record<string, QueueBroadcastEntry>;
}

export function broadcastFromQueue(config: BroadcastFromQueueConfig): SQSHandler {
  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const failures: SQSBatchItemFailure[] = [];
    for (const record of event.Records) {
      try {
        await processSqsRecord(record, config);
      } catch (err) {
        logger.error('broadcast-from-queue: record failed', {
          serviceName: config.serviceName,
          messageId: record.messageId,
          err: (err as Error).message,
        });
        failures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures: failures };
  };
}

async function processSqsRecord(
  record: SQSRecord,
  config: BroadcastFromQueueConfig,
): Promise<void> {
  const envelope = JSON.parse(record.body) as {
    id?: string;
    type: string;
    timestamp?: string;
    subject?: Record<string, unknown>;
    context?: EventContext;
  };

  const entry = config.broadcasts[envelope.type];
  if (!entry) return;

  const payload: EventPayload = {
    subject: envelope.subject ?? {},
    timestamp: envelope.timestamp,
  } as EventPayload;
  const ctx = (envelope.context ?? {}) as EventContext;

  const result = entry.mapPayload(payload, ctx);
  const calls = Array.isArray(result) ? result : [result];

  for (const variables of calls) {
    logger.info('broadcast-from-queue: firing', {
      serviceName: config.serviceName,
      pipelineName: 'broadcast-from-queue',
      eventId: envelope.id,
      type: envelope.type,
    });
    await postAppSyncMutation({
      appsyncUrl: config.appsyncUrl,
      region: config.region,
      mutation: entry.mutation,
      variables,
    });
  }
}
