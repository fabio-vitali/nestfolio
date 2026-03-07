import { getUUID, getTime } from './core';

/**
 * Error that should NOT be retried by the Lambda runtime.
 * When thrown inside a Highland stream, handleErrors publishes an error event
 * and drops the message (it goes to DLQ via SQS maxReceiveCount).
 */
export class NotRetryableError extends Error {
  constructor(
    public readonly message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * Shape of an AWS SDK ServiceException (duck-typed to avoid import coupling).
 */
interface AwsSdkError extends Error {
  $fault?: string;
  $retryable?: { throttling?: boolean };
}

function isAwsSdkError(error: unknown): error is AwsSdkError {
  return error instanceof Error && '$fault' in error;
}

/**
 * Checks if an error is retryable.
 * AWS SDK client errors with $retryable=undefined and $fault='client' are not retryable.
 * All other errors (server faults, network errors, unknown errors) are retryable.
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof NotRetryableError) return false;
  if (isAwsSdkError(error)) {
    return error.$retryable !== undefined || error.$fault !== 'client';
  }
  return true;
}

/**
 * Converts non-retryable AWS client errors to NotRetryableError.
 * Re-throws retryable errors so the Lambda runtime retries them.
 */
export function handleClientError(error: unknown): never {
  if (!isRetryable(error)) {
    const err = error as AwsSdkError;
    throw new NotRetryableError(err.message, {
      name: err.name,
      fault: err.$fault,
    });
  }
  throw error;
}

export type ErrorEvent = {
  id: string;
  type: string;
  timestamp: string;
  error: {
    name: string;
    message: string;
    details?: Record<string, unknown>;
  };
};

/**
 * Highland.js error handler for stream pipelines.
 * NotRetryableError → publishes error event to bus, drops the message.
 * All other errors → re-pushes the error to propagate (Lambda retries).
 */
export const handleErrors =
  (bus: { publish(event: ErrorEvent): Promise<void> }, errorEventType: string) =>
  (
    error: Error,
    push: (error: Error | null, x?: Highland.Stream<ErrorEvent>) => void,
  ): void => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const _ = require('highland') as HighlandStatic;

    if (error instanceof NotRetryableError) {
      const event: ErrorEvent = {
        id: getUUID(),
        timestamp: getTime(),
        type: errorEventType,
        error: {
          name: error.name,
          message: error.message,
          details: error.details,
        },
      };
      push(null, _(bus.publish(event).then(() => event)));
    } else {
      push(error);
    }
  };
