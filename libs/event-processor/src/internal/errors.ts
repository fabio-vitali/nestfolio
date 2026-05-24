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
 * Error thrown by `updateOrRetry()` when its `condition` precondition is not
 * yet satisfied. Wraps the original `ConditionalCheckFailedException` so the
 * `isRetryable` classifier does not see the AWS SDK's `$fault: 'client'`
 * marker and incorrectly drop the message.
 *
 * SQS partial-batch-failure semantics treat anything `isRetryable()` returns
 * `true` for as a redrive candidate; this class falls through to the default
 * (non-AwsSdkError → retryable) branch. The original SDK error is preserved
 * on `cause` for debugging.
 */
export class RetryablePreconditionError extends Error {
  constructor(
    public readonly condition: string,
    public readonly cause: unknown,
  ) {
    super(`update precondition not met (condition: ${condition}); SQS will redrive`);
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
 * AWS SDK exceptions that are transient by definition and must be retried even
 * though the SDK marks them `$fault: 'client'` with no `$retryable` hint.
 * `ServiceQuotaExceededException` ("resubmit your request later") covers the
 * Bedrock AgentCore `maxVms` ceiling; `ThrottlingException` covers rate limits.
 */
const RETRYABLE_CLIENT_FAULT_NAMES = new Set([
  'ServiceQuotaExceededException',
  'ThrottlingException',
]);

/**
 * Checks if an error is retryable.
 * AWS SDK client errors with $retryable=undefined and $fault='client' are not retryable,
 * except quota/throttle exceptions which are transient (see RETRYABLE_CLIENT_FAULT_NAMES).
 * All other errors (server faults, network errors, unknown errors) are retryable.
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof NotRetryableError) return false;
  if (isAwsSdkError(error)) {
    if (RETRYABLE_CLIENT_FAULT_NAMES.has(error.name)) return true;
    return error.$retryable !== undefined || error.$fault !== 'client';
  }
  return true;
}
