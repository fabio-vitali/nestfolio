import { withFallback } from '../src/with-fallback';

describe('withFallback (discriminated union)', () => {
  it('returns { ok: true, output } when the node succeeds', async () => {
    const node = jest.fn().mockResolvedValue({ value: 'primary' });
    const fallbackFn = jest.fn().mockReturnValue({ value: 'fallback' });
    const wrapped = withFallback(node, fallbackFn);
    const result = await wrapped({ input: 'test' });
    expect(result).toEqual({ ok: true, output: { value: 'primary' } });
    expect(fallbackFn).not.toHaveBeenCalled();
  });

  it('returns { ok: false, reason, fallback } when the node throws', async () => {
    const node = jest.fn().mockRejectedValue(new Error('boom'));
    const fallbackFn = jest.fn().mockReturnValue({ value: 'fallback' });
    const wrapped = withFallback(node, fallbackFn);
    const result = await wrapped({ input: 'test' });
    expect(result).toEqual({
      ok: false,
      reason: 'Error: boom',
      fallback: { value: 'fallback' },
    });
    expect(fallbackFn).toHaveBeenCalledWith({ input: 'test' });
  });

  it('captures error name and message in reason', async () => {
    class CustomError extends Error {
      constructor() {
        super('custom failure');
        this.name = 'CustomError';
      }
    }
    const node = jest.fn().mockRejectedValue(new CustomError());
    const fallbackFn = jest.fn().mockReturnValue({});
    const wrapped = withFallback(node, fallbackFn);
    const result = await wrapped({ input: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('CustomError: custom failure');
    }
  });

  it('propagates fallback function errors (fallback throws are not swallowed)', async () => {
    const node = jest.fn().mockRejectedValue(new Error('primary fail'));
    const fallbackFn = jest.fn().mockImplementation(() => {
      throw new Error('fallback fail');
    });
    const wrapped = withFallback(node, fallbackFn);
    await expect(wrapped({ input: 'test' })).rejects.toThrow('fallback fail');
  });

  it('forwards RunnableConfig to the wrapped node', async () => {
    const node = jest.fn().mockResolvedValue({ value: 'x' });
    const fallbackFn = jest.fn().mockReturnValue({});
    const wrapped = withFallback(node, fallbackFn);
    const cfg = { callbacks: [{ name: 'tracer' }] } as unknown as Parameters<typeof wrapped>[1];
    await wrapped({ input: 't' }, cfg);
    expect(node).toHaveBeenCalledWith({ input: 't' }, cfg);
  });
});
