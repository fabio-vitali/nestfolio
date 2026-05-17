import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { randomUUID } from 'crypto';
import { requireEnv } from '@nestfolio/event-processor';

/**
 * Lambda target for the MARKET_SNAPSHOT_REFRESH_TICK EventBridge scheduled rule.
 *
 * The CDK EventBus target (aws-events-targets EventBus) cannot transform a
 * scheduled rule's payload into a structured event-processor envelope — it
 * only forwards the originating event verbatim. So instead the scheduled rule
 * invokes this Lambda, which constructs the envelope and calls PutEvents
 * directly on the advisoryBus.
 *
 * The envelope shape matches what event-processor pipelines expect (id, type,
 * timestamp, subject, context). The detail-type is MARKET_SNAPSHOT_REFRESH_TICK,
 * which the market-intelligence-ctrl Ingress subscribes to (slow-tier rebuild).
 */

const SERVICE_NAME = 'market-intelligence-ctrl';
const EVENT_TYPE = 'MARKET_SNAPSHOT_REFRESH_TICK';

interface ScheduledEmitterDeps {
  readonly client: EventBridgeClient;
  readonly busName: string;
  readonly region: string;
  readonly now: () => Date;
  readonly newId: () => string;
}

export function createScheduledEmitter(deps: ScheduledEmitterDeps) {
  return async function handler(): Promise<{ ok: true; id: string }> {
    const now = deps.now();
    const id = deps.newId();

    const envelope = {
      id,
      type: EVENT_TYPE,
      source: SERVICE_NAME,
      timestamp: now.toISOString(),
      subject: { region: deps.region },
      context: {
        tenantId: 'SYSTEM',
        userId: 'SYSTEM',
        region: deps.region,
      },
    };

    await deps.client.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: deps.busName,
            Source: `${deps.busName}@${SERVICE_NAME}`,
            DetailType: EVENT_TYPE,
            Detail: JSON.stringify(envelope),
          },
        ],
      }),
    );

    return { ok: true, id };
  };
}

const busName = requireEnv('BUS_NAME');
const region = process.env.AWS_REGION ?? 'us-east-1';

export const handler = createScheduledEmitter({
  client: new EventBridgeClient({}),
  busName,
  region,
  now: () => new Date(),
  newId: () => randomUUID(),
});
