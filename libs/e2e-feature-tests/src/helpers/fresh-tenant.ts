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
