import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { requireEnv, logger } from '@nestfolio/event-processor';
import { SecEdgarAdptEventTypes } from '../domain/events';
import { randomUUID } from 'crypto';

const client = new EventBridgeClient({});

export const handler = async (): Promise<void> => {
  const busName = requireEnv('BUS_NAME');
  const serviceName = requireEnv('SERVICE_NAME');

  logger.info('Publishing FETCH_SEC_EDGAR_REQUESTED to advisory bus');

  await client.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: busName,
          Source: serviceName,
          DetailType: SecEdgarAdptEventTypes.FETCH_REQUESTED,
          Detail: JSON.stringify({
            id: randomUUID(),
            type: SecEdgarAdptEventTypes.FETCH_REQUESTED,
            timestamp: new Date().toISOString(),
            subject: {},
            context: { tenantId: 'SYSTEM' },
          }),
        },
      ],
    }),
  );

  logger.info('FETCH_SEC_EDGAR_REQUESTED published');
};
