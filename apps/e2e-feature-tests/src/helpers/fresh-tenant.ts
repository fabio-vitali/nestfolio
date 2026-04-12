import {
  CognitoFixture,
  type CognitoTokens,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

export interface FreshTenant {
  tenantId: string;
  userId: string;
  idToken: string;
  accessToken: string;
  cognitoTokens: CognitoTokens;
}

/**
 * Create a fresh Cognito user bound to the context's tenantId. The Cognito
 * `sub` claim becomes `userId`, matching the convention used by AppSync
 * resolvers throughout the codebase.
 */
export async function freshTenant(ctx: IntegrationContext): Promise<FreshTenant> {
  // Replace `integ-` prefix with `e2e-` so the CDC publisher in libs/event-processor
  // does NOT detect this as a test tenant. This routes events through the prod source
  // format (`InvestorBus@investor-bff`), which cross-domain adapter rules accept via
  // the first OR clause (`source: { 'anything-but': { 'prefix': 'integration-test:' } }`).
  // Per-service integration tests still use the `integ-` prefix and the existing
  // pre-staged source pattern; this override is e2e-feature-tests only.
  ctx.tenantId = ctx.tenantId.replace(/^integ-/, 'e2e-');
  ctx.userId = ctx.userId.replace(/^integ-/, 'e2e-');

  const cognito = new CognitoFixture(ctx);
  const tokens = await cognito.setup();

  const payload = JSON.parse(
    Buffer.from(tokens.idToken.split('.')[1], 'base64url').toString(),
  ) as { sub: string };

  return {
    tenantId: ctx.tenantId,
    userId: payload.sub,
    idToken: tokens.idToken,
    accessToken: tokens.accessToken,
    cognitoTokens: tokens,
  };
}
