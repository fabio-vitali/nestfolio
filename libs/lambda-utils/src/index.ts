// @nestfolio/lambda-utils — Shared Lambda runtime utilities
import { join } from 'path';

/** Absolute path to the event-publisher Lambda entry point (for CDK Egress construct) */
export const EVENT_PUBLISHER_ENTRY = join(__dirname, 'event-publisher.ts');

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
export { authorizeTenant, authorizeUser, type AuthorizedIdentity } from './authorize-tenant';
export { extractTenantId } from './extract-tenant-id';
export { validateQueryDepth } from './validate-query-depth';
export { createServiceMetrics, MetricUnit } from './service-metrics';
export { traceEvent } from './trace-event';
export { publishErrorEvent } from './publish-error-event';

// Middleware composition
export { applyMiddleware, type Middleware } from './middleware/apply-middleware';
export { withLambdaContext } from './middleware/with-lambda-context';
export { withTiming } from './middleware/with-timing';
export { withErrorPublishing } from './middleware/with-error-publishing';
export { withMethodLogging } from './middleware/with-method-logging';

// Test utilities
export { evaluateResolver, createAuthContext } from './test-utils/evaluate-resolver';
export type { EvalContext } from './test-utils/evaluate-resolver';
