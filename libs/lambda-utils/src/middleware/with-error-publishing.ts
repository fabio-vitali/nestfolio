import { type Bus, isRetryable, logger } from '@nestfolio/platform-core';
import type { Middleware } from './apply-middleware';

/**
 * Publishes non-retryable errors to EventBridge for monitoring/alerting.
 * Retryable errors are re-thrown for Lambda retry.
 */
export const withErrorPublishing = (bus: Bus, serviceName: string): Middleware =>
  (fn) =>
    async (...args: unknown[]) => {
      try {
        return await fn(...args);
      } catch (error) {
        if (!isRetryable(error)) {
          try {
            await bus.publish({
              id: crypto.randomUUID(),
              type: `${serviceName}.ERROR`,
              timestamp: new Date().toISOString(),
              error: {
                name: error instanceof Error ? error.name : 'UnknownError',
                message: error instanceof Error ? error.message : String(error),
              },
            });
          } catch (pubErr) {
            logger.warn('Failed to publish error event', { pubErr });
          }
        }
        throw error;
      }
    };
