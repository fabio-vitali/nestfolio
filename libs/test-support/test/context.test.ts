import { createTestContext } from '../src/context';

describe('createTestContext', () => {
  const originalEnv = { ...process.env };

  afterEach(async () => {
    process.env = { ...originalEnv };
  });

  describe('prefix resolution', () => {
    it('defaults to "dev" when no option and no env var', async () => {
      delete process.env.NESTFOLIO_INTEG_PREFIX;
      delete process.env.CI;

      const ctx = await createTestContext();

      expect(ctx.prefix).toBe('dev');
      await ctx.cleanup.runAll();
    });

    it('prefers options.prefix over env var and default', async () => {
      process.env.NESTFOLIO_INTEG_PREFIX = 'sandbox-pr-99';
      delete process.env.CI;

      const ctx = await createTestContext({ prefix: 'explicit' });

      expect(ctx.prefix).toBe('explicit');
      await ctx.cleanup.runAll();
    });

    it('uses NESTFOLIO_INTEG_PREFIX when option omitted', async () => {
      process.env.NESTFOLIO_INTEG_PREFIX = 'sandbox-pr-42';
      delete process.env.CI;

      const ctx = await createTestContext();

      expect(ctx.prefix).toBe('sandbox-pr-42');
      await ctx.cleanup.runAll();
    });
  });

  describe('CI misconfiguration guard', () => {
    it('throws when CI=true and no prefix option and no env var', async () => {
      process.env.CI = 'true';
      delete process.env.NESTFOLIO_INTEG_PREFIX;

      await expect(createTestContext()).rejects.toThrow(
        /NESTFOLIO_INTEG_PREFIX/,
      );
    });

    it('does not throw when CI=true and env var is set', async () => {
      process.env.CI = 'true';
      process.env.NESTFOLIO_INTEG_PREFIX = 'sandbox-pr-1';

      const ctx = await createTestContext();

      expect(ctx.prefix).toBe('sandbox-pr-1');
      await ctx.cleanup.runAll();
    });

    it('does not throw when CI=true and explicit prefix option is provided', async () => {
      process.env.CI = 'true';
      delete process.env.NESTFOLIO_INTEG_PREFIX;

      const ctx = await createTestContext({ prefix: 'explicit' });

      expect(ctx.prefix).toBe('explicit');
      await ctx.cleanup.runAll();
    });

    it('does not throw when CI is unset even if no prefix provided', async () => {
      delete process.env.CI;
      delete process.env.NESTFOLIO_INTEG_PREFIX;

      const ctx = await createTestContext();

      expect(ctx.prefix).toBe('dev');
      await ctx.cleanup.runAll();
    });
  });
});
