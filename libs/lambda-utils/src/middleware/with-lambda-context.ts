import type { Context } from 'aws-lambda';
import { logger } from '@nestfolio/platform-core';
import type { Middleware } from './apply-middleware';

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
