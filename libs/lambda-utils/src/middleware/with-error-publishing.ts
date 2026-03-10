import { type Bus } from '@nestfolio/platform-core';
import type { Middleware } from './apply-middleware';
import { publishErrorEvent } from '../publish-error-event';

/**
 * Middleware that publishes non-retryable errors to EventBridge.
 * Suitable for GraphQL resolvers where errors propagate out of the handler.
 * For SQS batch handlers, use publishErrorEvent() directly in catch blocks.
 */
export const withErrorPublishing = (bus: Bus, errorEventType: string): Middleware =>
  (fn) =>
    async (...args: unknown[]) => {
      try {
        return await fn(...args);
      } catch (error) {
        await publishErrorEvent(bus, errorEventType, error);
        throw error;
      }
    };
