// libs/agent-core/test/with-fallback.test.ts
import { withFallback } from '../src/with-fallback';

describe('withFallback', () => {
  it('returns node output when node succeeds', async () => {
    const node = jest.fn().mockResolvedValue({ value: 'primary' });
    const fallbackFn = jest.fn().mockReturnValue({ value: 'fallback' });
    const wrapped = withFallback(node, fallbackFn);
    const result = await wrapped({ input: 'test' });
    expect(result).toEqual({ value: 'primary' });
    expect(fallbackFn).not.toHaveBeenCalled();
  });

  it('calls fallback function when node throws', async () => {
    const node = jest.fn().mockRejectedValue(new Error('boom'));
    const fallbackFn = jest.fn().mockReturnValue({ value: 'fallback' });
    const wrapped = withFallback(node, fallbackFn);
    const result = await wrapped({ input: 'test' });
    expect(result).toEqual({ value: 'fallback' });
    expect(fallbackFn).toHaveBeenCalledWith({ input: 'test' });
  });

  it('propagates fallback error if fallback also throws', async () => {
    const node = jest.fn().mockRejectedValue(new Error('primary fail'));
    const fallbackFn = jest.fn().mockImplementation(() => { throw new Error('fallback fail'); });
    const wrapped = withFallback(node, fallbackFn);
    await expect(wrapped({ input: 'test' })).rejects.toThrow('fallback fail');
  });
});
