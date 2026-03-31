// @nestfolio/event-processor — public API

// Types
export type {
  WriteIntent, RecordIntent, ProjectIntent, AccumulateIntent, UpdateIntent, StoreIntent, SkipIntent, KeyOverrides,
  HandlerFn, HandlerEntry, EventPayload,
  EventContext,
  StreamRecord, StreamContext,
  RecordResult, IntentResult, BatchResult, RecordOutcome,
} from './types';

// Intent helpers
export { record } from './intents/record';
export { project } from './intents/project';
export { accumulate } from './intents/accumulate';
export { update } from './intents/update';
export { store } from './intents/store';
export { skip } from './intents/skip';

// Utilities
export { asyncPool } from './util/async-pool';
export { groupBy } from './util/group-by';
export { forkMerge } from './util/fork-merge';
export type { Branch, BranchResult } from './util/fork-merge';
export { toCsv } from './util/csv-serializer';
export { toUow } from './util/to-uow';

// SQS Pipelines
export { materializeToTable } from './pipelines/materialize-to-table';
export type { MaterializeToTableConfig } from './pipelines/materialize-to-table';
export { materializeToBucket } from './pipelines/materialize-to-bucket';
export type { MaterializeToBucketConfig } from './pipelines/materialize-to-bucket';
export { resumeStateMachine } from './pipelines/resume-state-machine';
export type { ResumeStateMachineConfig, ResumeHandler } from './pipelines/resume-state-machine';

// Stream Pipelines
export { changeDataCapture } from './pipelines/change-data-capture';
export type { ChangeDataCaptureConfig } from './pipelines/change-data-capture';
export { replayAndReduce } from './pipelines/replay-and-reduce';
export type { ReplayAndReduceConfig } from './pipelines/replay-and-reduce';

// Engine (advanced) — Ingestion
export { IngestionEngine } from './engine/ingestion-engine';
export type { IngestionEngineConfig } from './engine/ingestion-engine';
export type { IngestionRecord, IngestionResult, IngestionAdapter } from './engine/ingestion-types';
export { SqsIngestionAdapter } from './engine/sqs-adapter';
export { KinesisIngestionAdapter } from './engine/kinesis-adapter';
export { createIngestionHandler } from './engine/create-ingestion-handler';
export type { IngestionHandlerConfig } from './engine/create-ingestion-handler';
export { parseSqsRecord } from './engine/parse-sqs-record';
export { parseKinesisRecord } from './engine/parse-kinesis-record';

// Engine (advanced) — Egestion
export { EgestionEngine, EgestionBatchError } from './engine/egestion-engine';
export { EgestionBatchError as StreamBatchError } from './engine/egestion-engine';
export type { EgestionEngineConfig } from './engine/egestion-engine';
export { createEgestionHandler } from './engine/create-egestion-handler';
export type { EgestionHandlerConfig } from './engine/create-egestion-handler';

// Engine (advanced) — Shared
export { IntentExecutor } from './engine/intent-executor';
export { ErrorCollector } from './engine/error-collector';
export { ErrorEventPublisher } from './engine/error-event-publisher';
export { StreamCollector } from './engine/stream-collector';
export { BaseCollector } from './engine/base-collector';
export type { CollectedError } from './engine/base-collector';

// Testing (re-exported from /testing subpath)
export { createTestHarness } from './testing/test-harness';
export type { TestHarnessConfig, TestResult } from './testing/test-harness';
export { createStreamTestHarness, createCdcTestHarness, createReducerTestHarness } from './testing/test-harness';
export type { StreamTestResult, CdcTestResult, ReducerTestResult } from './testing/test-harness';
export { fakeSqsRecord, fakeDdbStreamRecord } from './testing/fake-records';

// Platform (from platform-core)
export {
  type Event, type Pipe, type UnitOfWork, envVar, getTime, getUUID,
  type TableEntry,
  type BusEvent, type Bus, EventBridgeBus,
  NotRetryableError, isRetryable, handleClientError, type ErrorEvent,
  log, logger, tracer,
  validateIncomingEvent, type ValidationResult,
  pipe,
  type Result, ok, err, isOk, isErr, mapResult, flatMapResult, tryCatch,
  type TenantId, type UserId, type EventId, asTenantId, asUserId, asEventId,
  TableRepository, EventRepository, BucketRepository,
  type Quote, type IndexData, type RateData, type MarketDataProvider,
  StaticMarketDataProvider, CachedMarketDataProvider, KNOWN_SYMBOLS,
} from './platform';

// Adapter utilities
export { publishOrUpload, type PublishOrUploadParams } from './lambda/publish-or-upload';
export { parseRssFeed, type RssArticle } from './lambda/rss-parser';

// Lambda utilities (from lambda-utils)
export {
  requireEnv,
  authorizeRequest,
  validateQueryDepth,
  createServiceMetrics, MetricUnit,
  publishErrorEvent,
  withErrorPublishing,
  withMethodLogging,
  applyMiddleware, withLambdaContext, withTiming,
  type Middleware,
  guardedWrite, extractRequestContext, traceEvent,
  evaluateResolver, createAuthContext, type EvalContext,
} from './lambda';

// Domain (shared infrastructure types & errors)
export {
  DomainError,
  DomainValidationError,
  EntityNotFoundError,
  BusinessRuleViolationError,
  TenantAccessDeniedError,
  BusEventSchema,
  RequestContextSchema,
  parseRequestContext,
} from './domain';
export type {
  BusEventPayload,
  RequestContext,
} from './domain';

// Sourcing (command + event replay)
export {
  type CommandDef, type CommandError, type Patches,
  defineCommand, applyCommand,
  type LedgerEntry, type EventReducer, replayEvents,
} from './sourcing';
