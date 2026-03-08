import { PostAuthenticationTriggerEvent, Context } from 'aws-lambda';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { randomUUID } from 'crypto';
import { requireEnv } from '@nestfolio/lambda-utils';

const ebClient = new EventBridgeClient({});
const BUS_NAME = requireEnv('BUS_NAME');
const SERVICE_NAME = requireEnv('SERVICE_NAME');

export const handler = async (event: PostAuthenticationTriggerEvent, _context: Context): Promise<PostAuthenticationTriggerEvent> => {
  const userId = event.request.userAttributes.sub;
  const tenantId = event.request.userAttributes['custom:tenant_id'];

  if (tenantId) {
    await ebClient.send(new PutEventsCommand({
      Entries: [{
        EventBusName: BUS_NAME,
        Source: `${BUS_NAME}@${SERVICE_NAME}`,
        DetailType: 'USER_AUTHENTICATED',
        Detail: JSON.stringify({
          id: randomUUID(),
          type: 'USER_AUTHENTICATED',
          timestamp: new Date().toISOString(),
          subject: { userId, tenantId },
          context: { tenantId },
        }),
      }],
    }));
  }

  return event; // Must return event for Cognito
};
