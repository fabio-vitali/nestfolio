// Cognito PostAuthentication trigger — synchronous with 5s timeout.
// Publishes USER_AUTHENTICATED directly to EventBridge (not via 3-tier ingestion)
// because Cognito requires a synchronous response to complete the login flow.
// See service.stack.ts for the scoped exception rationale.
import { PostAuthenticationTriggerEvent, Context } from 'aws-lambda';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { randomUUID } from 'crypto';
import { requireEnv } from '@nestfolio/event-processor';

const ebClient = new EventBridgeClient({});
const BUS_NAME = requireEnv('BUS_NAME');
const SERVICE_NAME = requireEnv('SERVICE_NAME');

export const handler = async (event: PostAuthenticationTriggerEvent, _context: Context): Promise<PostAuthenticationTriggerEvent> => {
  const userId = event.request.userAttributes.sub;
  const tenantId = event.request.userAttributes['custom:tenant_id'];

  if (tenantId) {
    const result = await ebClient.send(new PutEventsCommand({
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

    if (result.FailedEntryCount && result.FailedEntryCount > 0) {
      throw new Error(
        `Failed to publish USER_AUTHENTICATED event: ${result.Entries?.[0]?.ErrorMessage ?? 'unknown error'}`,
      );
    }
  }

  return event;
};
