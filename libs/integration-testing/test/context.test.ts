import { createIntegrationContext } from '../src/context';

describe('createIntegrationContext', () => {
  const originalEnv = { ...process.env };

  afterEach(async () => {
    process.env = { ...originalEnv };
  });

  describe('prefix resolution', () => {
    it('defaults to "dev" when no option and no env var', async () => {
      delete process.env.NESTFOLIO_INTEG_PREFIX;
      delete process.env.CI;

      const ctx = await createIntegrationContext();

      expect(ctx.prefix).toBe('dev');
      await ctx.cleanup.runAll();
    });

    it('prefers options.prefix over env var and default', async () => {
      process.env.NESTFOLIO_INTEG_PREFIX = 'sandbox-pr-99';
      delete process.env.CI;

      const ctx = await createIntegrationContext({ prefix: 'explicit' });

      expect(ctx.prefix).toBe('explicit');
      await ctx.cleanup.runAll();
    });

    it('uses NESTFOLIO_INTEG_PREFIX when option omitted', async () => {
      process.env.NESTFOLIO_INTEG_PREFIX = 'sandbox-pr-42';
      delete process.env.CI;

      const ctx = await createIntegrationContext();

      expect(ctx.prefix).toBe('sandbox-pr-42');
      await ctx.cleanup.runAll();
    });
  });
});
