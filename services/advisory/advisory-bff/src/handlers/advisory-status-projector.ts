import '../read-model-ownership';
import type { DynamoDBStreamEvent } from 'aws-lambda';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { IntentExecutor, projectVersioned, asTenantId, asUserId, type EventContext } from '@nestfolio/event-processor';
import { AdvisoryRepository } from '../repositories/advisory.repository';

const TABLE = process.env.TABLE_NAME!;
const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const repo = new AdvisoryRepository(TABLE, ddbClient);
const executor = new IntentExecutor({ docClient, tableName: TABLE });

// P3 derived aggregate. AdvisoryStatus.inFlightCount is RECOMPUTED post-commit by
// counting this tenant's non-terminal DecisionReadModel rows, rather than being
// accumulated by the ingress transform. This removes the two prior accumulate
// writers (decision-trigger-received +1, decision-packet-created -1) and the race
// between them: the count is always a pure function of the projected rows. The
// loop guard (skip AdvisoryStatus records) prevents the projector's own writes
// from re-triggering a recompute.
export const handler = async (event: DynamoDBStreamEvent): Promise<void> => {
  const tenants = new Set<string>();
  for (const rec of event.Records) {
    const image = rec.dynamodb?.NewImage ?? rec.dynamodb?.OldImage;
    if (!image) continue;
    const row = unmarshall(image as Record<string, AttributeValue>) as Record<string, unknown>;
    if (row.__typename !== 'DecisionReadModel') continue; // loop guard
    if (typeof row.tenantId === 'string') tenants.add(row.tenantId);
  }

  for (const tenantId of tenants) {
    const inFlightCount = await repo.countInFlightDecisions(tenantId);
    const version = Date.now();
    // System-originated recompute: no end-user request context. The
    // RequestContext fields are required by EventContext; supply system
    // sentinels — pickRequestContext copies them onto the AdvisoryStatus row
    // (harmless: the row is keyed/queried by pk/tenantId, never by userId).
    const ctx: EventContext = {
      tenantId: asTenantId(tenantId),
      userId: asUserId('system'),
      region: process.env.AWS_REGION ?? 'us-east-1',
      eventId: `recompute-${tenantId}-${version}`,
      eventType: 'ADVISORY_STATUS_RECOMPUTED',
      timestamp: new Date(version).toISOString(),
      serviceName: 'advisory-bff',
      record: {},
    };
    await executor.execute(
      projectVersioned('AdvisoryStatus', { tenantId, inFlightCount }, {
        version,
        overrides: { pk: `T#${tenantId}`, sk: 'AdvisoryStatus' },
      }),
      ctx,
    );
  }
};
