import { logger } from '@nestfolio/platform-core';
import { withMethodLogging } from './with-method-logging';

jest.mock('@nestfolio/platform-core', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

describe('withMethodLogging', () => {
  const log = withMethodLogging('TestRepository');

  beforeEach(() => jest.clearAllMocks());

  it('should log method entry and exit on success', async () => {
    const method = log('getItem', async (id: string) => ({ id, name: 'test' }));

    const result = await method('item-1');

    expect(result).toEqual({ id: 'item-1', name: 'test' });
    expect(logger.debug).toHaveBeenCalledWith(
      'TestRepository.getItem called',
      expect.objectContaining({ args: ['item-1'] }),
    );
    expect(logger.debug).toHaveBeenCalledWith('TestRepository.getItem completed');
  });

  it('should log method entry and error on failure', async () => {
    const method = log('saveItem', async () => {
      throw new Error('DDB error');
    });

    await expect(method()).rejects.toThrow('DDB error');

    expect(logger.debug).toHaveBeenCalledWith('TestRepository.saveItem called', expect.any(Object));
    expect(logger.error).toHaveBeenCalledWith(
      'TestRepository.saveItem failed',
      expect.objectContaining({
        error: { name: 'Error', message: 'DDB error' },
      }),
    );
  });

  it('should summarize object arguments', async () => {
    const method = log('putItem', async (item: Record<string, unknown>) => item);

    await method({ pk: 'test', sk: 'sort', data: { nested: true } });

    expect(logger.debug).toHaveBeenCalledWith(
      'TestRepository.putItem called',
      expect.objectContaining({ args: ['[object]'] }),
    );
  });

  it('should truncate long string arguments', async () => {
    const method = log('search', async (_q: string) => []);
    const longString = 'a'.repeat(200);

    await method(longString);

    const args = (logger.debug as jest.Mock).mock.calls[0][1].args;
    expect(args[0].length).toBeLessThan(200);
    expect(args[0].endsWith('...')).toBe(true);
  });
});
