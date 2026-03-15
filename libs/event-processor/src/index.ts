// @nestfolio/event-processor — public API

// Types
export type { WriteIntent, RecordIntent, ProjectIntent, AccumulateIntent, S3PutIntent, SkipIntent, KeyOverrides } from './types/write-intent';
export type { HandlerFn, HandlerEntry, EventPayload } from './types/handler-config';
export type { EventContext } from './types/event-context';
export type { StreamRecord, StreamContext } from './types/stream-types';
export type { RecordResult, IntentResult, BatchResult, RecordOutcome } from './types/result-types';

// Intent helpers
export { record } from './intents/record';
export { project } from './intents/project';
export { accumulate } from './intents/accumulate';
export { s3Put } from './intents/s3-put';
export { skip } from './intents/skip';

// Utilities
export { asyncPool } from './util/async-pool';
export { groupBy } from './util/group-by';
export { forkMerge } from './util/fork-merge';
export type { Branch, BranchResult } from './util/fork-merge';
export { toCsv } from './util/csv-serializer';

// SQS Pipelines
export { createEventHandler } from './pipelines/create-event-handler';
export type { EventHandlerConfig } from './pipelines/create-event-handler';
export { materializeToTable } from './pipelines/materialize-to-table';
export type { MaterializeToTableConfig } from './pipelines/materialize-to-table';

// Engine (advanced)
export { BatchEngine } from './engine/batch-engine';
export { IntentExecutor } from './engine/intent-executor';
export { ErrorCollector } from './engine/error-collector';
export { ErrorEventPublisher } from './engine/error-event-publisher';

// Testing (re-exported from /testing subpath)
export { createTestHarness } from './testing/test-harness';
export type { TestHarnessConfig, TestResult } from './testing/test-harness';
export { fakeSqsRecord, fakeDdbStreamRecord } from './testing/fake-records';
