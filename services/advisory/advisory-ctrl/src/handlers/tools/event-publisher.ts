// Handler for AgentCore Gateway tool: event-publisher
// Publishes events to the advisory EventBridge bus
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { logger } from '@nestfolio/event-processor';
import { requireEnv } from '@nestfolio/event-processor';

const BUS_NAME = requireEnv('BUS_NAME');
const client = new EventBridgeClient({});

export const handler = async (event: { eventType: string; detail: Record<string, unknown> }): Promise<unknown> => {
  logger.info('Publishing event', { eventType: event.eventType });

  await client.send(new PutEventsCommand({
    Entries: [{
      EventBusName: BUS_NAME,
      Source: 'advisory-ctrl',
      DetailType: event.eventType,
      Detail: JSON.stringify(event.detail),
    }],
  }));

  return { published: true, eventType: event.eventType };
};
