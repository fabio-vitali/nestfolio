import { PostConfirmationTriggerEvent, Context } from 'aws-lambda';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { CognitoIdentityProviderClient, AdminUpdateUserAttributesCommand } from '@aws-sdk/client-cognito-identity-provider';
import { randomUUID } from 'crypto';
import { requireEnv } from '@nestfolio/lambda-utils';

const ebClient = new EventBridgeClient({});
const cognitoClient = new CognitoIdentityProviderClient({});
const BUS_NAME = requireEnv('BUS_NAME');
const SERVICE_NAME = requireEnv('SERVICE_NAME');

export const handler = async (event: PostConfirmationTriggerEvent, _context: Context): Promise<PostConfirmationTriggerEvent> => {
  const tenantId = randomUUID();
  const userId = event.request.userAttributes.sub;
  const email = event.request.userAttributes.email;

  // Set tenant_id as custom attribute
  await cognitoClient.send(new AdminUpdateUserAttributesCommand({
    UserPoolId: event.userPoolId,
    Username: event.userName,
    UserAttributes: [{ Name: 'custom:tenant_id', Value: tenantId }],
  }));

  // Publish USER_REGISTERED event — propagate errors to fail the Cognito trigger
  const result = await ebClient.send(new PutEventsCommand({
    Entries: [{
      EventBusName: BUS_NAME,
      Source: `${BUS_NAME}@${SERVICE_NAME}`,
      DetailType: 'USER_REGISTERED',
      Detail: JSON.stringify({
        id: randomUUID(),
        type: 'USER_REGISTERED',
        timestamp: new Date().toISOString(),
        subject: { userId, tenantId, email },
        context: { tenantId },
      }),
    }],
  }));

  if (result.FailedEntryCount && result.FailedEntryCount > 0) {
    throw new Error(
      `Failed to publish USER_REGISTERED event: ${result.Entries?.[0]?.ErrorMessage ?? 'unknown error'}`,
    );
  }

  return event;
};
