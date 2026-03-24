export { requireEnv } from './require-env';
export { authorizeRequest } from './authorize-request';
export { validateQueryDepth } from './validate-query-depth';
export { createServiceMetrics, MetricUnit } from './service-metrics';
export { publishErrorEvent } from './publish-error-event';

// Middleware
export { withErrorPublishing } from './middleware/with-error-publishing';
export { withMethodLogging } from './middleware/with-method-logging';

// Re-export internal middleware + utilities
export { applyMiddleware, withLambdaContext, withTiming } from '../internal';
export type { Middleware } from '../internal';
export { guardedWrite } from '../internal';
export { extractRequestContext } from '../internal';
export { traceEvent } from '../internal';

// Test utilities
export { evaluateResolver, createAuthContext } from './test-utils/evaluate-resolver';
export type { EvalContext } from './test-utils/evaluate-resolver';
