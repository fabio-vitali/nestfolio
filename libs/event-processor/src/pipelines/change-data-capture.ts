import type { DynamoDBStreamEvent } from 'aws-lambda';
import type { PutEventsRequestEntry } from '@aws-sdk/client-eventbridge';
import type { StreamRecord, StreamContext } from '../types/stream-types';
import { EgestionEngine } from '../engine/egestion-engine';
import { EventBridgePublisher } from '../util/event-bridge-publisher';
import { getUUID } from '../internal';

type RuntimeFieldDispatch = {
  field: string;
  map: Record<string, string>;
  default?: string;
};

type RuntimePassthrough = {
  field: string;
  passthrough: true;
};

type RuntimeMapping = string | RuntimeFieldDispatch | RuntimePassthrough;
type RuntimeConfig = Record<string, RuntimeMapping>;

export interface ChangeDataCaptureConfig {
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
  config: RuntimeConfig,
): string | null {
  const key = `${record.__typename}:${eventName}`;
  const mapping = config[key];
  if (!mapping) return null;

  if (typeof mapping === 'string') return mapping;

  if ('passthrough' in mapping && mapping.passthrough) {
    return (record as Record<string, unknown>)[mapping.field] as string ?? null;
  }

  // Field dispatch
  const value = (record as Record<string, unknown>)[mapping.field] as string;
  return mapping.map[value] ?? mapping.default ?? null;
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

  // Tag CDC events from test tenants so other services' EB rules filter them out
  const isTestTenant = record.tenantId?.startsWith('integ-');
  const source = isTestTenant
    ? `integration-test:${serviceName}`
    : `${busName}@${serviceName}`;

  return {
    EventBusName: busName,
    Source: source,
    DetailType: eventType,
    Detail: JSON.stringify(detail),
  };
}

export function changeDataCapture(
  config: ChangeDataCaptureConfig = {},
): (event: DynamoDBStreamEvent) => Promise<void> {
  const runtimeConfig: RuntimeConfig = JSON.parse(process.env.EVENT_TYPE_MAP!);
  const serviceName = process.env.SERVICE_NAME!;
  const busName = config.bus ?? process.env.BUS_NAME!;
  const publisher = new EventBridgePublisher(busName, `${busName}@${serviceName}`);

  const processRecord = async (record: StreamRecord, ctx: StreamContext): Promise<void> => {
    const eventType = resolveEventType(record, record.eventName, runtimeConfig);
    if (!eventType) return;
    const entry = buildEntry(record, ctx, eventType, busName, serviceName, config.transform);
    await publisher.publish([entry]);
  };

  const processGroup = async (_groupKey: string, records: StreamRecord[], ctx: StreamContext): Promise<void> => {
    const entries: PutEventsRequestEntry[] = [];
    for (const record of records) {
      const eventType = resolveEventType(record, record.eventName, runtimeConfig);
      if (!eventType) continue;
      entries.push(buildEntry(record, ctx, eventType, busName, serviceName, config.transform));
    }
    if (entries.length > 0) {
      await publisher.publish(entries);
    }
  };

  if (config.groupBy) {
    const engine = new EgestionEngine({
      serviceName,
      groupBy: config.groupBy,
      processGroup,
      concurrency: config.concurrency,
      busName,
    });
    return (event: DynamoDBStreamEvent) => engine.process(event);
  }

  const engine = new EgestionEngine({
    serviceName,
    processRecord,
    concurrency: config.concurrency,
    busName,
  });
  return (event: DynamoDBStreamEvent) => engine.process(event);
}
