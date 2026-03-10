import type { Context } from 'aws-lambda';

/**
 * A middleware wraps a handler function with cross-cutting concerns.
 * Unlike pipe() (data transformation), middleware wraps behavior around a handler.
 */
export type Middleware = <A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
) => (...args: A) => Promise<R>;

/**
 * Composes middleware around a handler. Declaration order = execution order:
 * applyMiddleware(handler, mw1, mw2) → mw1 runs first (outermost), mw2 runs last (innermost).
 */
export function applyMiddleware<R>(
  handler: (event: unknown, context?: Context) => Promise<R>,
  ...middleware: Middleware[]
): (event: unknown, context?: Context) => Promise<R> {
  return middleware.reduceRight(
    (h, mw) => mw(h) as typeof h,
    handler,
  );
}
