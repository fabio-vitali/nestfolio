import type { DynamoDBStreamEvent } from 'aws-lambda';
import type { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import type { StreamRecord, StreamContext } from '../types/stream-types';
import { EgestionEngine } from './egestion-engine';

export interface EgestionHandlerConfig {
  serviceName: string;
  processRecord?: (record: StreamRecord, ctx: StreamContext) => Promise<void>;
  processGroup?: (groupKey: string, records: StreamRecord[], ctx: StreamContext) => Promise<void>;
  groupBy?: {
    key: (record: StreamRecord) => string;
    pick?: 'first' | 'last' | 'all';
  };
  filter?: (record: StreamRecord) => boolean;
  concurrency?: number;
  bus?: string | { name: string; client: EventBridgeClient };
  errorEventType?: string;
}

export function createEgestionHandler(
  config: EgestionHandlerConfig,
): (event: DynamoDBStreamEvent) => Promise<void> {
  const busName = typeof config.bus === 'string'
    ? config.bus
    : config.bus?.name ?? process.env.BUS_NAME;

  const engine = new EgestionEngine({
    serviceName: config.serviceName,
    filter: config.filter,
    groupBy: config.groupBy,
    processRecord: config.processRecord,
    processGroup: config.processGroup,
    concurrency: config.concurrency,
    busName,
    errorEventType: config.errorEventType,
  });

  return async (event: DynamoDBStreamEvent): Promise<void> => {
    return engine.process(event);
  };
}
