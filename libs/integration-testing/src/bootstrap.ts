import { createTestContext, type TestContext } from '@nestfolio/test-support';
import { OrphanReaper } from './fixtures/orphan-reaper';

/**
 * Integration test bootstrap helper.
 *
 * Composes `createTestContext` from `@nestfolio/test-support` with a one-shot
 * `OrphanReaper.cleanup()` so every integration suite reaps stale `integ-mock-*`
 * Lambdas/IAM roles and `integ-trap-*` SQS/EB rules from prior interrupted runs
 * automatically — no per-suite wiring required.
 *
 * Use this in every `*.integration.test.ts` `beforeAll`. Lower-layer tests that
 * need a `TestContext` without AWS-side cleanup (e.g. `libs/test-support`'s own
 * self-tests) should keep using `createTestContext` directly.
 *
 * Cleanup is best-effort — `OrphanReaper.cleanup()` catches and logs all
 * per-resource errors and never throws.
 */
export async function createIntegrationTestContext(
  options?: Parameters<typeof createTestContext>[0],
): Promise<TestContext> {
  const ctx = await createTestContext(options);
  await new OrphanReaper(ctx).cleanup();
  return ctx;
}
