import type { Context } from 'aws-lambda';
import { logger } from './logger';

/**
 * A middleware wraps a handler function with cross-cutting concerns.
 * Unlike pipe() (data transformation), middleware wraps behavior around a handler.
 */
export type Middleware = <A extends unknown[], R>(fn: (...args: A) => Promise<R>) => (...args: A) => Promise<R>;

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

let coldStart = true;

function isColdStart(): boolean {
  if (coldStart) {
    coldStart = false;
    return true;
  }
  return false;
}

/**
 * Enriches the logger with Lambda context (request ID, function name, cold start).
 */
export const withLambdaContext = (): Middleware =>
  (fn) =>
    async (event: unknown, context?: Context) => {
      if (context) {
        logger.addContext(context);
        logger.appendKeys({ coldStart: isColdStart() });
      }
      return fn(event, context);
    };

/** Reset cold start flag (for testing only). */
export function _resetColdStart(): void {
  coldStart = true;
}

/**
 * Logs handler duration on success and failure.
 */
export const withTiming = (name: string): Middleware =>
  (fn) =>
    async (...args: unknown[]) => {
      const start = Date.now();
      try {
        const result = await fn(...args);
        logger.info(`${name} completed`, { durationMs: Date.now() - start });
        return result;
      } catch (error) {
        logger.error(`${name} failed`, {
          durationMs: Date.now() - start,
          error: error instanceof Error
            ? { name: error.name, message: error.message }
            : { message: String(error) },
        });
        throw error;
      }
    };
