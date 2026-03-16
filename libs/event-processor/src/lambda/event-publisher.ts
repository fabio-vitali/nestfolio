import { DynamoDBStreamEvent, DynamoDBRecord } from 'aws-lambda';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import {
  EventBridgeClient,
  PutEventsCommand,
  PutEventsRequestEntry,
} from '@aws-sdk/client-eventbridge';
import { AttributeValue } from '@aws-sdk/client-dynamodb';
import { logger, NotRetryableError } from '../internal';
import { getUUID, getTime } from '../platform/core';

const client = new EventBridgeClient({});

const OPERATION_SUFFIX: Record<string, string> = {
  INSERT: 'CREATED',
  MODIFY: 'UPDATED',
  REMOVE: 'DELETED',
};

/**
 * Converts PascalCase or camelCase to SCREAMING_SNAKE_CASE.
 * e.g. 'DecisionPacket' -> 'DECISION_PACKET', 'OrderFilled' -> 'ORDER_FILLED'
 */
function toScreamingSnake(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
}

/**
 * Derives an event type name from DDB __typename + stream eventName.
 * Checks CUSTOM_EVENT_TYPE_MAP env var first (format: '{"Deposit:INSERT":"DEPOSIT_INITIATED"}').
 * Falls back to convention: e.g. ('Goal', 'INSERT') -> 'GOAL_CREATED', ('RiskProfile', 'MODIFY') -> 'RISK_PROFILE_UPDATED'
 */
function toDetailType(typename: string, eventName: string): string {
  const customMap: Record<string, string> = JSON.parse(
    process.env.CUSTOM_EVENT_TYPE_MAP || '{}',
  );
  const customKey = `${typename}:${eventName}`;
  if (customMap[customKey]) return customMap[customKey];
  const suffix = OPERATION_SUFFIX[eventName] ?? 'CHANGED';
  return `${toScreamingSnake(typename)}_${suffix}`;
}

/**
 * Extracts the event payload from a DynamoDB stream record's NEW_IMAGE.
 * Returns `undefined` if the record has no new image.
 */
function extractEvent(
  record: DynamoDBRecord,
): Record<string, unknown> | undefined {
  const image = record.dynamodb?.NewImage;
  if (!image) {
    return undefined;
  }
  return unmarshall(image as Record<string, AttributeValue>);
}

/**
 * Builds an EventBridge entry from a DynamoDB item and stream event name.
 * Derives DetailType from eventName + __typename (convention-based).
 * Wraps item in a BusEvent envelope for compatibility with Ingress consumers.
 */
function toEventBridgeEntry(
  item: Record<string, unknown>,
  eventName: string,
  busName: string,
  serviceName: string,
): PutEventsRequestEntry {
  const typename = (item.__typename as string) ?? 'Unknown';
  const detailType = toDetailType(typename, eventName);
  const busEvent = {
    id: (item.eventId as string) ?? getUUID(),
    type: detailType,
    timestamp: (item.timestamp as string) ?? getTime(),
    subject: item,
    context: { tenantId: item.tenantId as string },
  };
  return {
    EventBusName: busName,
    Source: `${busName}@${serviceName}`,
    DetailType: detailType,
    Detail: JSON.stringify(busEvent),
  };
}

/**
 * Lambda handler for DynamoDB Streams -> EventBridge publishing.
 * Used by the Egress CDK construct to forward table changes as domain events.
 *
 * Environment variables:
 * - BUS_NAME: EventBridge bus name
 * - SERVICE_NAME: Source service name
 */
export async function handler(event: DynamoDBStreamEvent): Promise<void> {
  const busName = process.env.BUS_NAME;
  const serviceName = process.env.SERVICE_NAME;

  if (!busName || !serviceName) {
    throw new NotRetryableError(
      'Missing required environment variables: BUS_NAME, SERVICE_NAME',
    );
  }

  const entries: PutEventsRequestEntry[] = [];

  for (const record of event.Records) {
    const item = extractEvent(record);
    if (!item) {
      logger.info('Skipping record with no NewImage', {
        eventID: record.eventID,
      });
      continue;
    }

    entries.push(toEventBridgeEntry(item, record.eventName ?? 'INSERT', busName, serviceName));
  }

  if (entries.length === 0) {
    logger.info('No events to publish');
    return;
  }

  const RETRYABLE_ERROR_CODES = new Set([
    'ThrottlingException',
    'InternalException',
  ]);
  const MAX_RETRIES = 2;

  // EventBridge PutEvents supports up to 10 entries per call
  const batchSize = 10;
  for (let i = 0; i < entries.length; i += batchSize) {
    let pending = entries.slice(i, i + batchSize);

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const result = await client.send(
        new PutEventsCommand({ Entries: pending }),
      );

      if (!result.FailedEntryCount || result.FailedEntryCount === 0) {
        logger.info('Published events to EventBridge', {
          count: pending.length,
          busName,
          attempt,
        });
        break;
      }

      // Identify failed entries and their error codes
      const resultEntries = result.Entries ?? [];
      const failedWithMeta = resultEntries
        .map((entry, idx) => ({ ...entry, originalEntry: pending[idx], index: idx }))
        .filter((entry) => entry.ErrorCode);

      const hasRetryable = failedWithMeta.some((e) =>
        RETRYABLE_ERROR_CODES.has(e.ErrorCode!),
      );
      const hasNonRetryable = failedWithMeta.some(
        (e) => !RETRYABLE_ERROR_CODES.has(e.ErrorCode!),
      );

      // If any non-retryable errors exist, fail immediately
      if (hasNonRetryable) {
        logger.error('Non-retryable event publish failure', {
          failedCount: result.FailedEntryCount,
          failedEntries: failedWithMeta.map(({ ErrorCode, ErrorMessage, index }) => ({
            ErrorCode,
            ErrorMessage,
            index,
          })),
        });
        throw new NotRetryableError(
          `Failed to publish ${result.FailedEntryCount} event(s) to EventBridge`,
        );
      }

      // All failures are retryable
      if (attempt < MAX_RETRIES && hasRetryable) {
        // Retry only the failed entries
        pending = failedWithMeta.map((e) => e.originalEntry);
        logger.info('Retrying failed EventBridge entries', {
          retryCount: pending.length,
          attempt: attempt + 1,
        });
        continue;
      }

      // Retries exhausted
      logger.error('Some events failed to publish after retries', {
        failedCount: result.FailedEntryCount,
        failedEntries: failedWithMeta.map(({ ErrorCode, ErrorMessage, index }) => ({
          ErrorCode,
          ErrorMessage,
          index,
        })),
      });
      throw new Error(
        `Failed to publish ${result.FailedEntryCount} event(s) to EventBridge after ${MAX_RETRIES} retries`,
      );
    }
  }
}

// Exported for testing
export { toScreamingSnake, toDetailType };
