import { NotRetryableError } from '@nestfolio/platform-core';
import { requireEnv } from '../src/require-env';

describe('requireEnv', () => {
  const ENV_KEY = 'TEST_REQUIRE_ENV_VAR';

  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it('returns the value when the env var is set', () => {
    process.env[ENV_KEY] = 'my-table';
    expect(requireEnv(ENV_KEY)).toBe('my-table');
  });

  it('throws NotRetryableError when the env var is undefined', () => {
    delete process.env[ENV_KEY];
    expect(() => requireEnv(ENV_KEY)).toThrow(NotRetryableError);
    expect(() => requireEnv(ENV_KEY)).toThrow(
      `Missing required environment variable: ${ENV_KEY}`,
    );
  });

  it('throws NotRetryableError when the env var is an empty string', () => {
    process.env[ENV_KEY] = '';
    expect(() => requireEnv(ENV_KEY)).toThrow(NotRetryableError);
  });

  it('includes the env var name in error details', () => {
    delete process.env[ENV_KEY];
    try {
      requireEnv(ENV_KEY);
      fail('Expected to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(NotRetryableError);
      expect((error as NotRetryableError).details).toEqual({ envVar: ENV_KEY });
    }
  });
});
