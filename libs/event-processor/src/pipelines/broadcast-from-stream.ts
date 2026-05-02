import type { DynamoDBStreamEvent, DynamoDBStreamHandler, DynamoDBRecord } from 'aws-lambda';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { logger } from '../internal';
import { postAppSyncMutation } from '../shared/post-appsync-mutation';

export interface StreamBroadcastEntry {
  /** GraphQL mutation source string. */
  mutation: string;
  /**
   * Field list. Broadcast iff strict equality differs on at least one field
   * between OldImage and NewImage. Arrays/objects always compare unequal
   * (different references after unmarshall) — over-broadcasts on collections,
   * which is the safer default. Use shouldBroadcast for value-equality.
   *
   * Empty array is equivalent to omitting this field — MODIFY events always
   * broadcast for the matched typename (subject only to shouldBroadcast).
   */
  whenChanged?: string[];
  /** Optional escape hatch — supplied predicate overrides whenChanged. */
  shouldBroadcast?: (
    newImage: Record<string, unknown>,
    oldImage: Record<string, unknown> | undefined,
    eventName: 'INSERT' | 'MODIFY' | 'REMOVE',
  ) => boolean;
  /** Default false — INSERT events broadcast. */
  skipInsert?: boolean;
  /** Builds mutation variables from the new image. */
  mapImage: (newImage: Record<string, unknown>) => Record<string, unknown>;
}

export interface BroadcastFromStreamConfig {
  serviceName: string;
  appsyncUrl: string;
  region?: string;
  /** Keyed by the row's `sk` (or `__typename` if your stream uses it). */
  broadcasts: Record<string, StreamBroadcastEntry>;
}

export function broadcastFromStream(config: BroadcastFromStreamConfig): DynamoDBStreamHandler {
  return async (event: DynamoDBStreamEvent): Promise<void> => {
    for (const record of event.Records) {
      try {
        await processRecord(record, config);
      } catch (err) {
        logger.error('broadcast-from-stream: record failed', {
          serviceName: config.serviceName,
          eventID: record.eventID,
          err: (err as Error).message,
        });
        // At-least-once: rethrow so the engine can surface for retry.
        throw err;
      }
    }
  };
}

async function processRecord(
  record: DynamoDBRecord,
  config: BroadcastFromStreamConfig,
): Promise<void> {
  const eventName = record.eventName as 'INSERT' | 'MODIFY' | 'REMOVE' | undefined;
  if (!eventName || eventName === 'REMOVE') return;

  const newImageRaw = record.dynamodb?.NewImage as Record<string, AttributeValue> | undefined;
  const oldImageRaw = record.dynamodb?.OldImage as Record<string, AttributeValue> | undefined;
  if (!newImageRaw) return;

  const newImage = unmarshall(newImageRaw);
  const oldImage = oldImageRaw ? unmarshall(oldImageRaw) : undefined;

  const typename = String(newImage['sk'] ?? newImage['__typename'] ?? '');
  const entry = config.broadcasts[typename];
  if (!entry) return;

  if (eventName === 'INSERT' && entry.skipInsert) return;

  if (entry.shouldBroadcast) {
    if (!entry.shouldBroadcast(newImage, oldImage, eventName)) return;
  } else if (eventName === 'MODIFY' && entry.whenChanged && entry.whenChanged.length > 0) {
    const changed = entry.whenChanged.some((f) => oldImage?.[f] !== newImage[f]);
    if (!changed) return;
  }

  const variables = entry.mapImage(newImage);
  logger.info('broadcast-from-stream: firing', {
    serviceName: config.serviceName,
    pipelineName: 'broadcast-from-stream',
    eventID: record.eventID,
    typename,
    eventName,
  });
  await postAppSyncMutation({
    appsyncUrl: config.appsyncUrl,
    region: config.region,
    mutation: entry.mutation,
    variables,
  });
}
