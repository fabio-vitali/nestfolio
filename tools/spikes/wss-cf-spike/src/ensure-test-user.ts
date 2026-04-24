import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminUpdateUserAttributesCommand,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider';

export async function ensureTestUser(params: {
  region: string;
  userPoolId: string;
  username: string;
  password: string;
  tenantId: string;
}): Promise<void> {
  const client = new CognitoIdentityProviderClient({ region: params.region });

  try {
    await client.send(
      new AdminCreateUserCommand({
        UserPoolId: params.userPoolId,
        Username: params.username,
        TemporaryPassword: params.password,
        MessageAction: 'SUPPRESS',
        UserAttributes: [
          { Name: 'email', Value: params.username },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'custom:tenant_id', Value: params.tenantId },
        ],
      }),
    );
  } catch (err) {
    if (!(err instanceof UsernameExistsException)) throw err;
  }

  await client.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: params.userPoolId,
      Username: params.username,
      Password: params.password,
      Permanent: true,
    }),
  );

  await client.send(
    new AdminUpdateUserAttributesCommand({
      UserPoolId: params.userPoolId,
      Username: params.username,
      UserAttributes: [{ Name: 'custom:tenant_id', Value: params.tenantId }],
    }),
  );
}
