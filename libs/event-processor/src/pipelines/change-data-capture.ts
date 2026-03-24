import type { DynamoDBStreamEvent } from 'aws-lambda';
import type { PutEventsRequestEntry } from '@aws-sdk/client-eventbridge';
import type { StreamRecord, StreamContext } from '../types/stream-types';
import { EgestionEngine } from '../engine/egestion-engine';
import { EventBridgePublisher } from '../util/event-bridge-publisher';
import { getUUID } from '../internal';

export interface ChangeDataCaptureConfig {
  serviceName: string;
  eventTypeMap: Record<string, string | ((record: StreamRecord) => string)>;
  groupBy?: {
    key: (record: StreamRecord) => string;
    pick?: 'first' | 'last';
  };
  bus?: string;
  concurrency?: number;
  transform?: (record: StreamRecord, eventType: string) => Record<string, unknown>;
}

function resolveEventType(
  record: StreamRecord,
  eventName: string,
  eventTypeMap: ChangeDataCaptureConfig['eventTypeMap'],
): string | null {
  const key = `${record.__typename}:${eventName}`;
  const resolver = eventTypeMap[key];
  if (!resolver) return null;
  return typeof resolver === 'function' ? resolver(record) : resolver;
}

function buildEntry(
  record: StreamRecord,
  ctx: StreamContext,
  eventType: string,
  busName: string,
  serviceName: string,
  transform?: ChangeDataCaptureConfig['transform'],
): PutEventsRequestEntry {
  const detail = {
    id: ctx.record.eventID ?? getUUID(),
    type: eventType,
    timestamp: new Date().toISOString(),
    subject: transform ? transform(record, eventType) : record,
    context: {
      tenantId: record.tenantId,
      userId: record.userId,
      region: record.region,
    },
  };

  return {
    EventBusName: busName,
    Source: `${busName}@${serviceName}`,
    DetailType: eventType,
    Detail: JSON.stringify(detail),
  };
}

export function changeDataCapture(
  config: ChangeDataCaptureConfig,
): (event: DynamoDBStreamEvent) => Promise<void> {
  const busName = config.bus ?? process.env.BUS_NAME!;
  const publisher = new EventBridgePublisher(busName, `${busName}@${config.serviceName}`);

  const processRecord = async (record: StreamRecord, ctx: StreamContext): Promise<void> => {
    const eventType = resolveEventType(record, record.eventName, config.eventTypeMap);
    if (!eventType) return;
    const entry = buildEntry(record, ctx, eventType, busName, config.serviceName, config.transform);
    await publisher.publish([entry]);
  };

  const processGroup = async (_groupKey: string, records: StreamRecord[], ctx: StreamContext): Promise<void> => {
    const entries: PutEventsRequestEntry[] = [];
    for (const record of records) {
      const eventType = resolveEventType(record, record.eventName, config.eventTypeMap);
      if (!eventType) continue;
      entries.push(buildEntry(record, ctx, eventType, busName, config.serviceName, config.transform));
    }
    if (entries.length > 0) {
      await publisher.publish(entries);
    }
  };

  if (config.groupBy) {
    const engine = new EgestionEngine({
      serviceName: config.serviceName,
      groupBy: config.groupBy,
      processGroup,
      concurrency: config.concurrency,
      busName,
    });
    return (event: DynamoDBStreamEvent) => engine.process(event);
  }

  const engine = new EgestionEngine({
    serviceName: config.serviceName,
    processRecord,
    concurrency: config.concurrency,
    busName,
  });
  return (event: DynamoDBStreamEvent) => engine.process(event);
}
