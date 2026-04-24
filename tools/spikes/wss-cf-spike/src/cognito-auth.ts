import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';

export async function getCognitoIdToken(params: {
  region: string;
  clientId: string;
  username: string;
  password: string;
}): Promise<string> {
  const client = new CognitoIdentityProviderClient({ region: params.region });
  const out = await client.send(
    new InitiateAuthCommand({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: params.clientId,
      AuthParameters: {
        USERNAME: params.username,
        PASSWORD: params.password,
      },
    }),
  );
  const idToken = out.AuthenticationResult?.IdToken;
  if (!idToken) throw new Error('No IdToken in Cognito auth response');
  return idToken;
}
