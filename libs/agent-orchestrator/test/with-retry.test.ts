// libs/agent-core/test/with-retry.test.ts
import { withRetry } from '../src/with-retry';
import { ValidationError } from '../src/types';

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const node = jest.fn().mockResolvedValue({ value: 'ok' });
    const wrapped = withRetry(node, { maxAttempts: 3 });
    const result = await wrapped({ input: 'test' });
    expect(result).toEqual({ value: 'ok' });
    expect(node).toHaveBeenCalledTimes(1);
  });

  it('retries on ValidationError up to maxAttempts', async () => {
    const node = jest.fn()
      .mockRejectedValueOnce(new ValidationError(['bad1']))
      .mockRejectedValueOnce(new ValidationError(['bad2']))
      .mockResolvedValue({ value: 'ok' });
    const wrapped = withRetry(node, { maxAttempts: 3 });
    const result = await wrapped({ input: 'test' });
    expect(result).toEqual({ value: 'ok' });
    expect(node).toHaveBeenCalledTimes(3);
  });

  it('throws after maxAttempts exhausted', async () => {
    const node = jest.fn().mockRejectedValue(new ValidationError(['always bad']));
    const wrapped = withRetry(node, { maxAttempts: 2 });
    await expect(wrapped({ input: 'test' })).rejects.toThrow(ValidationError);
    expect(node).toHaveBeenCalledTimes(2);
  });

  it('does not retry on non-ValidationError', async () => {
    const node = jest.fn().mockRejectedValue(new Error('unexpected'));
    const wrapped = withRetry(node, { maxAttempts: 3 });
    await expect(wrapped({ input: 'test' })).rejects.toThrow('unexpected');
    expect(node).toHaveBeenCalledTimes(1);
  });

  it('applies escalation path by modifying state __escalationTier', async () => {
    const calls: Record<string, unknown>[] = [];
    const node = jest.fn().mockImplementation(async (state: Record<string, unknown>) => {
      calls.push({ ...state });
      throw new ValidationError(['fail']);
    });
    const wrapped = withRetry(node, {
      maxAttempts: 3,
      escalationPath: ['haiku', 'sonnet', 'opus'],
    });
    await expect(wrapped({ input: 'test' })).rejects.toThrow(ValidationError);
    expect(calls[0].__escalationTier).toBeUndefined();
    expect(calls[1].__escalationTier).toBe('sonnet');
    expect(calls[2].__escalationTier).toBe('opus');
  });

  it('reverts to original model when escalation path is shorter than maxAttempts', async () => {
    const calls: Record<string, unknown>[] = [];
    const node = jest.fn().mockImplementation(async (state: Record<string, unknown>) => {
      calls.push({ ...state });
      throw new ValidationError(['fail']);
    });
    const wrapped = withRetry(node, {
      maxAttempts: 4,
      escalationPath: ['haiku', 'sonnet'],
    });
    await expect(wrapped({ input: 'test' })).rejects.toThrow(ValidationError);
    expect(calls).toHaveLength(4);
    expect(calls[0].__escalationTier).toBeUndefined();
    expect(calls[1].__escalationTier).toBe('sonnet');
    expect(calls[2].__escalationTier).toBeUndefined();
    expect(calls[3].__escalationTier).toBeUndefined();
  });

  it('writes __retryAttempt to state on every attempt (0, 1, 2, …)', async () => {
    const calls: Record<string, unknown>[] = [];
    const node = jest.fn().mockImplementation(async (state: Record<string, unknown>) => {
      calls.push({ ...state });
      throw new ValidationError(['fail']);
    });
    const wrapped = withRetry(node, { maxAttempts: 3 });
    await expect(wrapped({ input: 'test' })).rejects.toThrow(ValidationError);
    expect(calls[0].__retryAttempt).toBe(0);
    expect(calls[1].__retryAttempt).toBe(1);
    expect(calls[2].__retryAttempt).toBe(2);
  });

  it('writes __retryFeedback from error.feedback after a failed attempt', async () => {
    const calls: Record<string, unknown>[] = [];
    const node = jest.fn()
      .mockImplementationOnce(async (state: Record<string, unknown>) => {
        calls.push({ ...state });
        throw new ValidationError(['bad'], { feedback: 'corrective text' });
      })
      .mockImplementationOnce(async (state: Record<string, unknown>) => {
        calls.push({ ...state });
        return { value: 'recovered' };
      });
    const wrapped = withRetry(node, { maxAttempts: 3 });
    const result = await wrapped({ input: 'test' });
    expect(result).toEqual({ value: 'recovered' });
    expect(calls[0].__retryFeedback).toBeUndefined();
    expect(calls[1].__retryFeedback).toBe('corrective text');
  });

  it('falls back to errors.join when error.feedback is absent', async () => {
    const calls: Record<string, unknown>[] = [];
    const node = jest.fn()
      .mockImplementationOnce(async (state: Record<string, unknown>) => {
        calls.push({ ...state });
        throw new ValidationError(['err1', 'err2']);
      })
      .mockImplementationOnce(async (state: Record<string, unknown>) => {
        calls.push({ ...state });
        return { value: 'ok' };
      });
    const wrapped = withRetry(node, { maxAttempts: 3 });
    await wrapped({ input: 'test' });
    expect(calls[1].__retryFeedback).toBe('err1\nerr2');
  });

  it('still does not retry on non-ValidationError', async () => {
    const node = jest.fn().mockRejectedValue(new Error('boom'));
    const wrapped = withRetry(node, { maxAttempts: 3 });
    await expect(wrapped({ input: 'test' })).rejects.toThrow('boom');
    expect(node).toHaveBeenCalledTimes(1);
  });
});
