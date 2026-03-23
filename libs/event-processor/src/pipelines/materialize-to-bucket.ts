import type { SQSEvent, SQSBatchResponse, Context } from 'aws-lambda';
import { createIngestionHandler } from '../engine/create-ingestion-handler';
import type { HandlerEntry } from '../types/handler-config';

export interface MaterializeToBucketConfig {
  serviceName: string;
  handlers: Record<string, HandlerEntry>;
  bucket?: string;
  bus?: string;
  concurrency?: number;
  poisonPill?: { maxReceiveCount: number };
  defaultFormat?: 'json' | 'csv';
}

export function materializeToBucket(
  config: MaterializeToBucketConfig,
): (event: SQSEvent, context?: Context) => Promise<SQSBatchResponse> {
  return createIngestionHandler({
    serviceName: config.serviceName,
    handlers: config.handlers,
    bus: config.bus,
    concurrency: config.concurrency,
    poisonPill: config.poisonPill,
    s3: { bucket: config.bucket ?? process.env.EXPORT_BUCKET! },
  });
}
