import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { requireEnv, logger } from '@nestfolio/event-processor';
import { YahooFinanceAdptEventTypes } from '../domain/events';
import { randomUUID } from 'crypto';

const client = new EventBridgeClient({});

export const handler = async (): Promise<void> => {
  const busName = requireEnv('BUS_NAME');
  const serviceName = requireEnv('SERVICE_NAME');

  logger.info('Publishing FETCH_YAHOO_FINANCE_REQUESTED to advisory bus');

  await client.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: busName,
          Source: serviceName,
          DetailType: YahooFinanceAdptEventTypes.FETCH_REQUESTED,
          Detail: JSON.stringify({
            id: randomUUID(),
            type: YahooFinanceAdptEventTypes.FETCH_REQUESTED,
            timestamp: new Date().toISOString(),
            subject: {},
            context: { tenantId: 'SYSTEM' },
          }),
        },
      ],
    }),
  );

  logger.info('FETCH_YAHOO_FINANCE_REQUESTED published');
};
