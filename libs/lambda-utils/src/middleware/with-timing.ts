import { logger } from '@nestfolio/platform-core';
import type { Middleware } from './apply-middleware';

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
