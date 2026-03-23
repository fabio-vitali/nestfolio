import type { SQSEvent, SQSBatchResponse, KinesisStreamEvent, KinesisStreamBatchResponse, Context } from 'aws-lambda';
import type { HandlerEntry } from '../types/handler-config';
import { createIngestionHandler } from '../engine/create-ingestion-handler';

export interface MaterializeToTableConfig {
  serviceName: string;
  handlers: Record<string, HandlerEntry>;
  table?: string;
  bus?: string;
  concurrency?: number;
  poisonPill?: { maxReceiveCount: number };
  errorEventType?: string;
}

export function materializeToTable(
  config: MaterializeToTableConfig & { transport?: 'sqs' },
): (event: SQSEvent, context?: Context) => Promise<SQSBatchResponse>;

export function materializeToTable(
  config: MaterializeToTableConfig & { transport: 'kinesis' },
): (event: KinesisStreamEvent, context?: Context) => Promise<KinesisStreamBatchResponse>;

export function materializeToTable(
  config: MaterializeToTableConfig & { transport?: 'sqs' | 'kinesis' },
): any {
  return createIngestionHandler({
    serviceName: config.serviceName,
    handlers: config.handlers,
    table: config.table ?? process.env.TABLE_NAME!,
    bus: config.bus ?? process.env.BUS_NAME,
    concurrency: config.concurrency,
    poisonPill: config.poisonPill,
    errorEventType: config.errorEventType,
    transport: config.transport,
  } as any);
}
