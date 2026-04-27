import { test as base, type Page } from '@playwright/test';
import { createTestContext, type TestContext } from '@nestfolio/test-support';
import { freshTenant, type FreshTenant } from '@nestfolio/e2e-feature-tests';
import { seedAmplifyTokens, assertAmplifySessionAlive } from './seed-amplify-tokens';

interface Fx {
  ctx: TestContext;
  tenant: FreshTenant;
  authedPage: Page;
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
    await assertAmplifySessionAlive(page);
    await use(page);
  },
});

export { expect } from '@playwright/test';
