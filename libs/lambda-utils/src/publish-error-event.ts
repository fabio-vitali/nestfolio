import { type Bus, type ErrorEvent, NotRetryableError, getUUID, getTime, logger } from '@nestfolio/platform-core';

/**
 * Publishes a non-retryable error as an ErrorEvent to EventBridge.
 * Mirrors shape-services `handleErrors` pattern for async/await handlers.
 *
 * - Only publishes for NotRetryableError instances (retryable errors are retried via SQS)
 * - Swallows publish failures (logs warning) to avoid masking the original error
 */
export async function publishErrorEvent(
  bus: Bus,
  errorEventType: string,
  error: unknown,
): Promise<void> {
  if (!(error instanceof NotRetryableError)) return;

  const event: ErrorEvent = {
    id: getUUID(),
    timestamp: getTime(),
    type: errorEventType,
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
