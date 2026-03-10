import { NotRetryableError, logger } from '@nestfolio/platform-core';
import { withErrorPublishing } from './with-error-publishing';

jest.mock('@nestfolio/platform-core', () => {
  class MockNotRetryableError extends Error {
    constructor(message: string, public readonly details?: Record<string, unknown>) {
      super(message);
      this.name = 'NotRetryableError';
    }
  }
  return {
    NotRetryableError: MockNotRetryableError,
    isRetryable: (error: unknown) => {
      if (error instanceof MockNotRetryableError) return false;
      return true;
    },
    logger: { warn: jest.fn() },
  };
});

describe('withErrorPublishing', () => {
  const mockBus = { publish: jest.fn().mockResolvedValue(undefined) };

  beforeEach(() => jest.clearAllMocks());

  it('should pass through on success', async () => {
    const handler = jest.fn().mockResolvedValue('ok');
    const wrapped = withErrorPublishing(mockBus as any, 'test-svc')(handler);

    const result = await wrapped('event');

    expect(result).toBe('ok');
    expect(mockBus.publish).not.toHaveBeenCalled();
  });

  it('should publish error event for non-retryable errors', async () => {
    const error = new NotRetryableError('validation failed');
    const handler = jest.fn().mockRejectedValue(error);
    const wrapped = withErrorPublishing(mockBus as any, 'test-svc')(handler);

    await expect(wrapped('event')).rejects.toThrow('validation failed');

    expect(mockBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'test-svc.ERROR',
        error: { name: 'NotRetryableError', message: 'validation failed' },
      }),
    );
  });

  it('should NOT publish error event for retryable errors', async () => {
    const error = new Error('transient failure');
    const handler = jest.fn().mockRejectedValue(error);
    const wrapped = withErrorPublishing(mockBus as any, 'test-svc')(handler);

    await expect(wrapped('event')).rejects.toThrow('transient failure');

    expect(mockBus.publish).not.toHaveBeenCalled();
  });

  it('should still throw original error even if publishing fails', async () => {
    const error = new NotRetryableError('bad input');
    const handler = jest.fn().mockRejectedValue(error);
    mockBus.publish.mockRejectedValue(new Error('publish failed'));
    const wrapped = withErrorPublishing(mockBus as any, 'test-svc')(handler);

    await expect(wrapped('event')).rejects.toThrow('bad input');

    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to publish error event',
      expect.objectContaining({ pubErr: expect.any(Error) }),
    );
  });

  it('should re-throw retryable errors for Lambda retry', async () => {
    const error = new Error('server error');
    const handler = jest.fn().mockRejectedValue(error);
    const wrapped = withErrorPublishing(mockBus as any, 'test-svc')(handler);

    await expect(wrapped('event')).rejects.toThrow('server error');
  });
});
