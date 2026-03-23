import type {
  SQSEvent,
  SQSBatchResponse,
  KinesisStreamEvent,
  KinesisStreamBatchResponse,
  Context,
} from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { applyMiddleware, withLambdaContext, withTiming } from '../internal';
import type { HandlerEntry } from '../types/handler-config';
import { IngestionEngine } from './ingestion-engine';
import { SqsIngestionAdapter } from './sqs-adapter';
import { KinesisIngestionAdapter } from './kinesis-adapter';

export interface IngestionHandlerConfig {
  transport?: 'sqs' | 'kinesis';
  serviceName: string;
  handlers: Record<string, HandlerEntry>;
  table?: string | { name: string; client: DynamoDBDocumentClient };
  bus?: string;
  s3?: { bucket: string };
  concurrency?: number;
  poisonPill?: { maxReceiveCount: number };
  errorEventType?: string;
}

export function createIngestionHandler(
  config: IngestionHandlerConfig & { transport?: 'sqs' },
): (event: SQSEvent, context?: Context) => Promise<SQSBatchResponse>;

export function createIngestionHandler(
  config: IngestionHandlerConfig & { transport: 'kinesis' },
): (event: KinesisStreamEvent, context?: Context) => Promise<KinesisStreamBatchResponse>;

export function createIngestionHandler(
  config: IngestionHandlerConfig,
):
  | ((event: SQSEvent, context?: Context) => Promise<SQSBatchResponse>)
  | ((event: KinesisStreamEvent, context?: Context) => Promise<KinesisStreamBatchResponse>) {
  const tableName =
    typeof config.table === 'string'
      ? config.table
      : config.table?.name ?? process.env['TABLE_NAME']!;

  const docClient =
    typeof config.table === 'object' && 'client' in config.table
      ? config.table.client
      : DynamoDBDocumentClient.from(new DynamoDBClient({}));

  const s3Client = config.s3 ? new S3Client({}) : undefined;

  const engine = new IngestionEngine({
    serviceName: config.serviceName,
    handlers: config.handlers,
    docClient,
    tableName,
    busName: typeof config.bus === 'string' ? config.bus : process.env['BUS_NAME'],
    concurrency: config.concurrency,
    errorEventType: config.errorEventType,
    s3Client,
    bucket: config.s3?.bucket,
  });

  if (config.transport === 'kinesis') {
    const adapter = new KinesisIngestionAdapter();

    const handler = async (event: unknown): Promise<KinesisStreamBatchResponse> => {
      const records = adapter.toRecords(event as KinesisStreamEvent);
      const result = await engine.process(records);
      return adapter.toResponse(result);
    };

    return applyMiddleware(
      handler,
      withLambdaContext(),
      withTiming(`${config.serviceName}-event-listener`),
    ) as (event: KinesisStreamEvent, context?: Context) => Promise<KinesisStreamBatchResponse>;
  }

  // Default: SQS
  const adapter = new SqsIngestionAdapter({
    poisonPillMaxReceiveCount: config.poisonPill?.maxReceiveCount,
  });

  const handler = async (event: unknown): Promise<SQSBatchResponse> => {
    const sqsEvent = event as SQSEvent;
    const records = adapter.toRecords(sqsEvent);
    const result = await engine.process(records);
    // Track poison pill metrics
    const poisonPills = adapter.countPoisonPills(sqsEvent);
    if (poisonPills > 0) {
      result.metrics['PoisonPillDetected'] = (result.metrics['PoisonPillDetected'] ?? 0) + poisonPills;
      result.metrics['BatchSize'] = (result.metrics['BatchSize'] ?? 0) + poisonPills;
    }
    return adapter.toResponse(result);
  };

  return applyMiddleware(
    handler,
    withLambdaContext(),
    withTiming(`${config.serviceName}-event-listener`),
  ) as (event: SQSEvent, context?: Context) => Promise<SQSBatchResponse>;
}
