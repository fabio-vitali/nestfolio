import type { SQSEvent, SQSBatchResponse, Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { applyMiddleware, withLambdaContext, withTiming } from '@nestfolio/lambda-utils';
import type { HandlerEntry } from '../types/handler-config';
import { BatchEngine } from '../engine/batch-engine';

export interface EventHandlerConfig {
  serviceName: string;
  handlers: Record<string, HandlerEntry>;
  table?: string | { name: string; client: DynamoDBDocumentClient };
  bus?: string;
  s3?: { bucket: string };
  concurrency?: number;
  poisonPill?: { maxReceiveCount: number };
  errorEventType?: string;
}

export function createEventHandler(
  config: EventHandlerConfig,
): (event: SQSEvent, context?: Context) => Promise<SQSBatchResponse> {
  const tableName = typeof config.table === 'string'
    ? config.table
    : config.table?.name ?? process.env.TABLE_NAME!;

  const docClient = typeof config.table === 'object' && 'client' in config.table
    ? config.table.client
    : DynamoDBDocumentClient.from(new DynamoDBClient({}));

  const engine = new BatchEngine({
    serviceName: config.serviceName,
    handlers: config.handlers,
    docClient,
    tableName,
    busName: typeof config.bus === 'string' ? config.bus : process.env.BUS_NAME,
    concurrency: config.concurrency,
    poisonPillMaxReceiveCount: config.poisonPill?.maxReceiveCount,
    errorEventType: config.errorEventType,
  });

  const handler = async (event: unknown): Promise<SQSBatchResponse> => {
    return engine.process(event as SQSEvent);
  };

  return applyMiddleware(
    handler,
    withLambdaContext(),
    withTiming(`${config.serviceName}-event-listener`),
  ) as (event: SQSEvent, context?: Context) => Promise<SQSBatchResponse>;
}
