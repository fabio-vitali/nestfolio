import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminInitiateAuthCommand,
  AdminDeleteUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import type { TestContext } from '../context';

export interface CognitoTokens {
  idToken: string;
  accessToken: string;
}

// Cognito throttles PostAuthentication trigger invocations (~10 TPS per user
// pool) and admin APIs; bursts across sequential --runInBand tests surface as
// UnexpectedLambdaException wrapping TooManyRequestsException. Retry with
// exponential backoff keeps fixture setup resilient to transient throttling.
const isRetryableCognitoError = (err: unknown): boolean => {
  const name = (err as { name?: string } | null)?.name;
  const message = (err as { message?: string } | null)?.message ?? '';
  return (
    name === 'TooManyRequestsException' ||
    name === 'ThrottlingException' ||
    name === 'LimitExceededException' ||
    (name === 'UnexpectedLambdaException' && message.includes('TooManyRequestsException'))
  );
};

async function withCognitoRetry<T>(op: () => Promise<T>, label: string): Promise<T> {
  const maxAttempts = 5;
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await op();
    } catch (err) {
      lastErr = err;
      if (!isRetryableCognitoError(err) || attempt === maxAttempts - 1) throw err;
      const backoffMs = 1000 * Math.pow(2, attempt) + Math.floor(Math.random() * 500);
      // eslint-disable-next-line no-console
      console.warn(`CognitoFixture.${label}: retrying after throttle (attempt ${attempt + 1}/${maxAttempts}, wait ${backoffMs}ms)`);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastErr;
}

export class CognitoFixture {
  private readonly client: CognitoIdentityProviderClient;
  private readonly ctx: TestContext;
  private username?: string;
  private userPoolId?: string;

  constructor(ctx: TestContext) {
    this.ctx = ctx;
    this.client = new CognitoIdentityProviderClient({ region: ctx.region });
  }

  async setup(): Promise<CognitoTokens> {
    this.userPoolId = await this.ctx.ssm.userPoolId();
    const clientId = await this.ctx.ssm.userPoolClientId();
    const email = `integ-${Date.now()}@test.nestfolio.dev`;
    this.username = email;
    const password = 'IntegTest1!';

    // Create user with suppressed verification email
    await withCognitoRetry(() => this.client.send(new AdminCreateUserCommand({
      UserPoolId: this.userPoolId,
      Username: email,
      MessageAction: 'SUPPRESS',
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'custom:tenant_id', Value: this.ctx.tenantId },
      ],
    })), 'AdminCreateUser');

    // Set permanent password (bypasses FORCE_CHANGE_PASSWORD)
    await withCognitoRetry(() => this.client.send(new AdminSetUserPasswordCommand({
      UserPoolId: this.userPoolId,
      Username: email,
      Password: password,
      Permanent: true,
    })), 'AdminSetUserPassword');

    // Authenticate to get tokens (invokes PostAuthentication trigger Lambda)
    const authResult = await withCognitoRetry(() => this.client.send(new AdminInitiateAuthCommand({
      UserPoolId: this.userPoolId,
      ClientId: clientId,
      AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
      },
    })), 'AdminInitiateAuth');

    // Register cleanup
    this.ctx.cleanup.register('CognitoFixture', () => this.teardown());

    return {
      idToken: authResult.AuthenticationResult!.IdToken!,
      accessToken: authResult.AuthenticationResult!.AccessToken!,
    };
  }

  async teardown(): Promise<void> {
    if (!this.username || !this.userPoolId) return;
    try {
      await this.client.send(new AdminDeleteUserCommand({
        UserPoolId: this.userPoolId,
        Username: this.username,
      }));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('CognitoFixture: failed to delete test user', err);
    }
  }
}
