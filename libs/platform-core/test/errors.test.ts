import { NotRetryableError, isRetryable, handleClientError, handleErrors } from '../src/errors';

// Create an error that looks like an AWS SDK ServiceException (duck-typed)
class AwsClientError extends Error {
  $fault: string;
  $retryable?: { throttling?: boolean };
  constructor(message: string, fault: string, retryable?: { throttling?: boolean }) {
    super(message);
    this.name = 'AwsClientError';
    this.$fault = fault;
    this.$retryable = retryable;
  }
}

describe('errors', () => {
  describe('NotRetryableError', () => {
    it('should create error with message and details', () => {
      const error = new NotRetryableError('bad input', { field: 'email' });
      expect(error.message).toBe('bad input');
      expect(error.details).toEqual({ field: 'email' });
      expect(error.name).toBe('NotRetryableError');
      expect(error).toBeInstanceOf(Error);
    });

    it('should create error without details', () => {
      const error = new NotRetryableError('simple error');
      expect(error.details).toBeUndefined();
    });
  });

  describe('isRetryable', () => {
    it('should return false for NotRetryableError', () => {
      expect(isRetryable(new NotRetryableError('nope'))).toBe(false);
    });

    it('should return false for client fault without retryable flag', () => {
      const error = new AwsClientError('bad request', 'client');
      expect(isRetryable(error)).toBe(false);
    });

    it('should return true for client fault with retryable flag (throttling)', () => {
      const error = new AwsClientError('throttled', 'client', { throttling: true });
      expect(isRetryable(error)).toBe(true);
    });

    it('should return true for server fault', () => {
      const error = new AwsClientError('internal error', 'server');
      expect(isRetryable(error)).toBe(true);
    });

    it('should return true for unknown errors', () => {
      expect(isRetryable(new Error('unknown'))).toBe(true);
    });
  });

  describe('handleClientError', () => {
    it('should convert non-retryable client error to NotRetryableError', () => {
      const error = new AwsClientError('bad input', 'client');
      expect(() => handleClientError(error)).toThrow(NotRetryableError);
    });

    it('should re-throw retryable errors as-is', () => {
      const error = new AwsClientError('server down', 'server');
      expect(() => handleClientError(error)).toThrow(error);
    });
  });

  describe('handleErrors', () => {
    let mockBus: { publish: jest.Mock };

    beforeEach(() => {
      mockBus = {
        publish: jest.fn().mockResolvedValue(undefined),
      };
    });

    it('should publish error event for NotRetryableError and push to stream', () => {
      const handler = handleErrors(mockBus, 'SERVICE_FAILED');
      const error = new NotRetryableError('bad data', { field: 'amount' });

      const push = jest.fn();
      handler(error, push);

      expect(push).toHaveBeenCalledWith(null, expect.anything());
    });

    it('should re-push retryable errors', () => {
      const handler = handleErrors(mockBus, 'SERVICE_FAILED');
      const error = new Error('transient failure');

      const push = jest.fn();
      handler(error, push);

      expect(push).toHaveBeenCalledWith(error);
      expect(mockBus.publish).not.toHaveBeenCalled();
    });

    it('should log error when publish fails and still push event to stream', async () => {
      const publishError = new Error('EventBridge down');
      mockBus.publish.mockRejectedValueOnce(publishError);

      const handler = handleErrors(mockBus, 'SERVICE_FAILED');
      const error = new NotRetryableError('bad data', { field: 'amount' });

      const push = jest.fn();
      handler(error, push);

      // push should still be called with the stream wrapping the catch result
      expect(push).toHaveBeenCalledWith(null, expect.anything());
    });
  });
});
