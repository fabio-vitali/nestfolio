import { test as base, type Page } from '@playwright/test';
import { createTestContext, type TestContext } from '@nestfolio/test-support';
import { freshTenant, type FreshTenant } from '@nestfolio/e2e-feature-tests';
import { seedAmplifyTokens, assertAmplifySessionAlive } from './seed-amplify-tokens';

/**
 * localStorage key that `nestfolio-host` reads on bootstrap to restore the
 * onboarding-completed timestamp when the Cognito JWT does not yet carry the
 * `custom:onboarding_completed_at` claim (the CDC→SetUserAttributes chain is
 * not wired today). Mirrors `ONBOARDING_COMPLETED_KEY` from `@nestfolio/shell`
 * — duplicated here to avoid an Angular-lib import in the Node test harness.
 */
const ONBOARDING_COMPLETED_KEY = 'nestfolio.onboardingCompletedAt';

interface Fx {
  ctx: TestContext;
  tenant: FreshTenant;
  authedPage: Page;
  /** authedPage + `nestfolio.onboardingCompletedAt` seeded in localStorage so
   *  the `onboardingCompletedGuard` sees the tenant as already onboarded.
   *  Use this fixture for tests that need to reach /advisory or /dashboard
   *  without driving the full onboarding wizard first. */
  onboardedPage: Page;
}

/**
 * Derive the Cognito username Amplify will write into LastAuthUser. The
 * `cognito:username` claim is added to every Cognito-issued idToken; decoding
 * it from the test tenant's idToken avoids exposing CognitoFixture internals
 * through the freshTenant helper.
 */
function deriveUsername(tenant: FreshTenant): string {
  const [, payload] = tenant.idToken.split('.');
  if (!payload) throw new Error('idToken missing payload segment');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
    'cognito:username'?: string;
  };
  const username = claims['cognito:username'];
  if (!username) throw new Error('idToken missing cognito:username claim');
  return username;
}

export const test = base.extend<Fx>({
  // eslint-disable-next-line no-empty-pattern
  ctx: async ({}, use) => {
    const ctx = await createTestContext();
    await use(ctx);
    await ctx.cleanup.runAll();
  },
  tenant: async ({ ctx }, use) => {
    const tenant = await freshTenant(ctx);
    await use(tenant);
  },
  authedPage: async ({ ctx, tenant, page }, use) => {
    const clientId = await ctx.ssm.userPoolClientId();
    const username = deriveUsername(tenant);
    await seedAmplifyTokens(page, {
      clientId,
      username,
      tokens: tenant.cognitoTokens,
    });
    await page.goto('/');
    await assertAmplifySessionAlive(page, { clientId, username });
    await use(page);
  },
  onboardedPage: async ({ ctx, tenant, page }, use) => {
    const clientId = await ctx.ssm.userPoolClientId();
    const username = deriveUsername(tenant);
    await seedAmplifyTokens(page, {
      clientId,
      username,
      tokens: tenant.cognitoTokens,
    });
    // Seed the onboarding-completed timestamp so `initializeAuth()` in the
    // host app reads it from localStorage and sets `user.onboardingCompletedAt`.
    // This bypasses the `onboardingCompletedGuard` redirect to /onboarding —
    // the same state that would exist after a real user completes the wizard.
    await page.addInitScript(
      ({ key, value }: { key: string; value: string }) => {
        localStorage.setItem(key, value);
      },
      { key: ONBOARDING_COMPLETED_KEY, value: new Date().toISOString() },
    );
    await page.goto('/');
    await assertAmplifySessionAlive(page, { clientId, username });
    await use(page);
  },
});

export { expect } from '@playwright/test';
