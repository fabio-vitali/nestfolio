import { logger, NotRetryableError } from '../internal';
import { getUUID, getTime } from '../platform/core';
import type { Bus } from '../platform/bus';
import type { ErrorEvent } from '../platform/errors';
import type { RequestContext } from '../domain/schemas';

/**
 * Publishes a non-retryable error as an ErrorEvent to EventBridge.
 * Optionally includes RequestContext for traceability.
 */
export async function publishErrorEvent(
  bus: Bus,
  errorEventType: string,
  error: unknown,
  context?: RequestContext,
): Promise<void> {
  if (!(error instanceof NotRetryableError)) return;

  const event: ErrorEvent = {
    id: getUUID(),
    timestamp: getTime(),
    type: errorEventType,
    ...(context && { context }),
    error: {
      name: error.name,
      message: error.message,
      ...(error.details && { details: error.details }),
    },
  };

  try {
    await bus.publish(event);
  } catch (pubErr) {
    logger.warn('Failed to publish error event', { pubErr, originalEvent: event });
  }
}
