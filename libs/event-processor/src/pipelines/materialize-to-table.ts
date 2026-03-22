import type { SQSEvent, SQSBatchResponse, Context } from 'aws-lambda';
import type { HandlerEntry } from '../types/handler-config';
import { createEventHandler } from '../engine/create-event-handler';

export interface MaterializeToTableConfig {
  serviceName: string;
  handlers: Record<string, HandlerEntry>;
  table?: string;
  bus?: string;
  concurrency?: number;
  poisonPill?: { maxReceiveCount: number };
}

export function materializeToTable(
  config: MaterializeToTableConfig,
): (event: SQSEvent, context?: Context) => Promise<SQSBatchResponse> {
  return createEventHandler({
    serviceName: config.serviceName,
    handlers: config.handlers,
    table: config.table ?? process.env.TABLE_NAME!,
    bus: config.bus ?? process.env.BUS_NAME,
    concurrency: config.concurrency,
    poisonPill: config.poisonPill,
  });
}
