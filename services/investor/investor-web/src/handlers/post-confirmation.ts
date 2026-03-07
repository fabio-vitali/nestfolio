import { PostConfirmationTriggerEvent, Context } from 'aws-lambda';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { CognitoIdentityProviderClient, AdminUpdateUserAttributesCommand } from '@aws-sdk/client-cognito-identity-provider';
import { randomUUID } from 'crypto';

const ebClient = new EventBridgeClient({});
const cognitoClient = new CognitoIdentityProviderClient({});
const BUS_NAME = process.env.BUS_NAME!;
const SERVICE_NAME = process.env.SERVICE_NAME!;

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

  // Publish USER_REGISTERED event
  await ebClient.send(new PutEventsCommand({
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

  return event; // Must return event for Cognito
};
