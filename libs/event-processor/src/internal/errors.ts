/**
 * Error that should NOT be retried by the Lambda runtime.
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
