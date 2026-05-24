import { isRetryable, NotRetryableError, RetryablePreconditionError } from '../../src/internal/errors';

describe('isRetryable', () => {
  it('treats ServiceQuotaExceededException as retryable despite $fault client', () => {
    const err = Object.assign(new Error('maxVms limit exceeded'), {
      name: 'ServiceQuotaExceededException',
      $fault: 'client',
    });
    expect(isRetryable(err)).toBe(true);
  });

  it('treats ThrottlingException as retryable despite $fault client', () => {
    const err = Object.assign(new Error('Rate exceeded'), {
      name: 'ThrottlingException',
      $fault: 'client',
    });
    expect(isRetryable(err)).toBe(true);
  });

  it('keeps a generic client-fault AWS exception non-retryable', () => {
    const err = Object.assign(new Error('bad input'), {
      name: 'ValidationException',
      $fault: 'client',
    });
    expect(isRetryable(err)).toBe(false);
  });

  it('treats a server-fault AWS exception as retryable', () => {
    const err = Object.assign(new Error('internal error'), {
      name: 'InternalServerException',
      $fault: 'server',
    });
    expect(isRetryable(err)).toBe(true);
  });

  it('treats NotRetryableError as non-retryable', () => {
    expect(isRetryable(new NotRetryableError('nope'))).toBe(false);
  });

  it('treats a plain non-AWS error as retryable', () => {
    expect(isRetryable(new Error('network blip'))).toBe(true);
  });

  it('treats RetryablePreconditionError as retryable so SQS redrives updateOrRetry() misses', () => {
    const original = Object.assign(new Error('cond fail'), {
      name: 'ConditionalCheckFailedException',
      $fault: 'client',
    });
    const wrapped = new RetryablePreconditionError('attribute_exists(pk)', original);
    expect(isRetryable(wrapped)).toBe(true);
    // Sanity check: the original SDK error WOULD be terminal — only the
    // wrapper is retryable. This is the whole point of the wrapper.
    expect(isRetryable(original)).toBe(false);
  });
});
