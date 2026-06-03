import '../read-model-ownership';
import type { DynamoDBStreamEvent } from 'aws-lambda';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { IntentExecutor, projectVersioned, asTenantId, asUserId, getTime, type EventContext } from '@nestfolio/event-processor';
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
  // Strictly-monotonic version per tenant: the max DynamoDB-stream SequenceNumber
  // of the tenant's DecisionReadModel records in this batch. SequenceNumbers
  // increase within a shard, and a tenant's rows share a pk -> same shard.
  // Number() is lossy above 2^53, but distinct invocations are temporally
  // separated well above that floor -- strictly better than the Date.now()
  // same-ms collision it replaces (two same-ms recomputes produced equal
  // versions and the #__version < :version guard dropped the fresher count).
  const tenantMaxSeq = new Map<string, number>();
  for (const rec of event.Records) {
    const image = rec.dynamodb?.NewImage ?? rec.dynamodb?.OldImage;
    if (!image) continue;
    const row = unmarshall(image as Record<string, AttributeValue>) as Record<string, unknown>;
    if (row.__typename !== 'DecisionReadModel') continue; // loop guard
    if (typeof row.tenantId !== 'string') continue;
    const seq = Number(rec.dynamodb?.SequenceNumber ?? 0);
    if (seq > (tenantMaxSeq.get(row.tenantId) ?? 0)) tenantMaxSeq.set(row.tenantId, seq);
  }

  for (const [tenantId, version] of tenantMaxSeq) {
    const inFlightCount = await repo.countInFlightDecisions(tenantId);
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
      timestamp: getTime(),
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
