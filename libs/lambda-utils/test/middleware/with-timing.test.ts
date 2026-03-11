import { logger } from '@nestfolio/platform-core';
import { withTiming } from '../../src/middleware/with-timing';

jest.mock('@nestfolio/platform-core', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
  },
}));

describe('withTiming', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should log duration on success', async () => {
    const handler = jest.fn().mockResolvedValue('result');
    const wrapped = withTiming('test-handler')(handler);

    const result = await wrapped('event');

    expect(result).toBe('result');
    expect(logger.info).toHaveBeenCalledWith(
      'test-handler completed',
      expect.objectContaining({ durationMs: expect.any(Number) }),
    );
  });

  it('should log duration on failure and re-throw', async () => {
    const error = new Error('boom');
    const handler = jest.fn().mockRejectedValue(error);
    const wrapped = withTiming('test-handler')(handler);

    await expect(wrapped('event')).rejects.toThrow('boom');

    expect(logger.error).toHaveBeenCalledWith(
      'test-handler failed',
      expect.objectContaining({
        durationMs: expect.any(Number),
        error: { name: 'Error', message: 'boom' },
      }),
    );
  });

  it('should pass through all arguments to the handler', async () => {
    const handler = jest.fn().mockResolvedValue('ok');
    const wrapped = withTiming('test')(handler);

    await wrapped('event', { requestId: '123' } as any);

    expect(handler).toHaveBeenCalledWith('event', { requestId: '123' });
  });

  it('should handle non-Error throws', async () => {
    const handler = jest.fn().mockRejectedValue('string-error');
    const wrapped = withTiming('test')(handler);

    await expect(wrapped('event')).rejects.toBe('string-error');

    expect(logger.error).toHaveBeenCalledWith(
      'test failed',
      expect.objectContaining({
        error: { message: 'string-error' },
      }),
    );
  });
});
