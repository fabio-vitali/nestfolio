// @nestfolio/lambda-utils — Shared Lambda runtime utilities
// Re-export core types from platform-core for convenience
export {
  type BusEvent,
  type UnitOfWork,
  type Bus,
  type Pipe,
  EventBridgeBus,
  NotRetryableError,
  isRetryable,
} from '@nestfolio/platform-core';

// lambda-utils own exports
export { parseRecord } from './sqs-parser';
export { IdempotencyGuard } from './idempotency';
export { buildContainer } from './container';
export { requireEnv } from './require-env';
