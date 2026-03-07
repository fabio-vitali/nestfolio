import { DynamoDBStreamEvent, DynamoDBRecord } from 'aws-lambda';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import {
  EventBridgeClient,
  PutEventsCommand,
  PutEventsRequestEntry,
} from '@aws-sdk/client-eventbridge';
import { AttributeValue } from '@aws-sdk/client-dynamodb';
import { logger } from '@nestfolio/platform-core';

const client = new EventBridgeClient({});

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
 * Builds an EventBridge entry from a DynamoDB item.
 * Uses the item's `__typename` as the DetailType and the item itself as the Detail.
 */
function toEventBridgeEntry(
  item: Record<string, unknown>,
  busName: string,
  serviceName: string,
): PutEventsRequestEntry {
  const detailType = (item.__typename as string) ?? 'Unknown';
  return {
    EventBusName: busName,
    Source: `${busName}@${serviceName}`,
    DetailType: detailType,
    Detail: JSON.stringify(item),
  };
}

/**
 * Lambda handler for DynamoDB Streams → EventBridge publishing.
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
    throw new Error(
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

    entries.push(toEventBridgeEntry(item, busName, serviceName));
  }

  if (entries.length === 0) {
    logger.info('No events to publish');
    return;
  }

  // EventBridge PutEvents supports up to 10 entries per call
  const batchSize = 10;
  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);

    const result = await client.send(
      new PutEventsCommand({ Entries: batch }),
    );

    if (result.FailedEntryCount && result.FailedEntryCount > 0) {
      const failedEntries = (result.Entries ?? [])
        .map((entry, idx) => ({ ...entry, index: idx }))
        .filter((entry) => entry.ErrorCode);

      logger.error('Some events failed to publish', {
        failedCount: result.FailedEntryCount,
        failedEntries,
      });

      throw new Error(
        `Failed to publish ${result.FailedEntryCount} event(s) to EventBridge`,
      );
    }

    logger.info('Published events to EventBridge', {
      count: batch.length,
      busName,
    });
  }
}
