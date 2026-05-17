import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { logger, requireEnv } from '@nestfolio/event-processor';

/**
 * CloudFormation custom resource handler that, on stack Create only,
 * emits a synthetic MARKET_SNAPSHOT_REFRESH_TICK event onto the advisory bus
 * and blocks until the MarketSnapshot row materialises (5-minute deadline).
 *
 * Update and Delete are no-ops. Subsequent deploys (where the row already
 * exists at Create time) skip the bootstrap.
 *
 * The synthetic envelope mirrors the shape published by scheduled-emitter.ts
 * — same EB Source (`${BUS_NAME}@market-intelligence-ctrl`), same JSON keys
 * (id, type, source, timestamp, subject, context). The Ingress filters on
 * detail-type MARKET_SNAPSHOT_REFRESH_TICK and forwards to the same handler.
 */

const SERVICE_NAME = 'market-intelligence-ctrl';
const EVENT_TYPE = 'MARKET_SNAPSHOT_REFRESH_TICK';

const eb = new EventBridgeClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const BUS_NAME = requireEnv('BUS_NAME');
const TABLE_NAME = requireEnv('TABLE_NAME');
const REGION = process.env.AWS_REGION ?? 'us-east-1';

const SNAPSHOT_PK = `MarketSnapshot#${REGION}`;
const SNAPSHOT_SK = 'MarketSnapshot';

interface CfnCustomResourceEvent {
  RequestType: 'Create' | 'Update' | 'Delete';
  [key: string]: unknown;
}

interface CfnCustomResourceResponse {
  PhysicalResourceId: string;
  Status: 'SUCCESS';
}

const PHYSICAL_ID = 'market-snapshot-bootstrap';

async function snapshotExists(): Promise<boolean> {
  const r = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: SNAPSHOT_PK, sk: SNAPSHOT_SK },
    }),
  );
  return Boolean(r.Item);
}

async function emitSyntheticTick(): Promise<void> {
  const now = new Date();
  const envelope = {
    id: randomUUID(),
    type: EVENT_TYPE,
    source: SERVICE_NAME,
    timestamp: now.toISOString(),
    subject: { region: REGION },
    context: {
      tenantId: 'SYSTEM',
      userId: 'SYSTEM',
      region: REGION,
    },
    // Marker so log greps can distinguish bootstrap ticks from scheduled ticks.
    bootstrap: true,
  };

  await eb.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: BUS_NAME,
          Source: `${BUS_NAME}@${SERVICE_NAME}`,
          DetailType: EVENT_TYPE,
          Detail: JSON.stringify(envelope),
        },
      ],
    }),
  );
}

export const handler = async (
  event: CfnCustomResourceEvent,
): Promise<CfnCustomResourceResponse> => {
  // CloudFormation custom resource lifecycle: Create / Update / Delete.
  // We bootstrap only on Create. Update/Delete are no-ops.
  if (event.RequestType !== 'Create') {
    return { PhysicalResourceId: PHYSICAL_ID, Status: 'SUCCESS' };
  }

  // Already materialised? Skip.
  if (await snapshotExists()) {
    logger.info('MarketSnapshot already exists; bootstrap skipped');
    return { PhysicalResourceId: PHYSICAL_ID, Status: 'SUCCESS' };
  }

  logger.info('Emitting synthetic MARKET_SNAPSHOT_REFRESH_TICK for bootstrap');
  await emitSyntheticTick();

  // Poll for row materialisation. 5-minute deadline; on timeout the resource
  // fails and CloudFormation rolls back the stack.
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    if (await snapshotExists()) {
      logger.info('MarketSnapshot bootstrap complete');
      return { PhysicalResourceId: PHYSICAL_ID, Status: 'SUCCESS' };
    }
    await new Promise((res) => setTimeout(res, 5_000));
  }
  throw new Error('MarketSnapshot bootstrap timed out after 5 minutes');
};
