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
    await this.client.send(new AdminCreateUserCommand({
      UserPoolId: this.userPoolId,
      Username: email,
      MessageAction: 'SUPPRESS',
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'custom:tenant_id', Value: this.ctx.tenantId },
      ],
    }));

    // Set permanent password (bypasses FORCE_CHANGE_PASSWORD)
    await this.client.send(new AdminSetUserPasswordCommand({
      UserPoolId: this.userPoolId,
      Username: email,
      Password: password,
      Permanent: true,
    }));

    // Authenticate to get tokens
    const authResult = await this.client.send(new AdminInitiateAuthCommand({
      UserPoolId: this.userPoolId,
      ClientId: clientId,
      AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
      },
    }));

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
