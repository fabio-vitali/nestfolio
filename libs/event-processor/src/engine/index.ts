export { normalizeHandler } from './normalize-handler';
export { IntentExecutor } from './intent-executor';
export { BaseCollector } from './base-collector';
export type { CollectedError } from './base-collector';
export { ErrorCollector } from './error-collector';
export type { CollectorResults } from './error-collector';
export { ErrorEventPublisher } from './error-event-publisher';
export { StreamCollector } from './stream-collector';

// Ingestion
export { IngestionEngine } from './ingestion-engine';
export type { IngestionEngineConfig } from './ingestion-engine';
export type { IngestionRecord, IngestionResult, IngestionAdapter } from './ingestion-types';
export { SqsIngestionAdapter } from './sqs-adapter';
export type { SqsAdapterOptions } from './sqs-adapter';
export { KinesisIngestionAdapter } from './kinesis-adapter';
export { createIngestionHandler } from './create-ingestion-handler';
export type { IngestionHandlerConfig } from './create-ingestion-handler';
export { parseSqsRecord } from './parse-sqs-record';
export { parseKinesisRecord } from './parse-kinesis-record';

// Egestion
export { EgestionEngine, EgestionBatchError } from './egestion-engine';
export { EgestionBatchError as StreamBatchError } from './egestion-engine';
export type { EgestionEngineConfig } from './egestion-engine';
export { createEgestionHandler } from './create-egestion-handler';
export type { EgestionHandlerConfig } from './create-egestion-handler';
