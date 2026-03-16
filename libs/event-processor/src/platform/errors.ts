import { NotRetryableError, isRetryable } from '../internal';

export { NotRetryableError, isRetryable };

interface AwsSdkError extends Error {
  $fault?: string;
  $retryable?: { throttling?: boolean };
}

function isAwsSdkError(error: unknown): error is AwsSdkError {
  return error instanceof Error && '$fault' in error;
}

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
