import '../read-model-ownership';
import type { DynamoDBStreamEvent } from 'aws-lambda';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { IntentExecutor, update, asTenantId, asUserId, type EventContext } from '@nestfolio/event-processor';
import { AdvisoryRepository } from '../repositories/advisory.repository';

const TABLE = process.env.TABLE_NAME!;
const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const repo = new AdvisoryRepository(TABLE, ddbClient);
const executor = new IntentExecutor({ docClient, tableName: TABLE });

// AdvisoryStatus is advisory-bff's OWN command-owned derived aggregate.
// The aggregate (inFlightCount/generatingCount/failedCount/oldestGeneratingAt) is
// RECOMPUTED post-commit by deriveAdvisoryAggregate (one query over this tenant's
// non-terminal DecisionReadModel rows), then written with an atomic self-increment
// of __version via update(..., { add: { __version: 1 } }).
// The loop guard (skip AdvisoryStatus
// records) prevents the projector's own writes from re-triggering a recompute.
//
// VERSION = atomic counter (ADD #__version :1), NOT wall clock. A prior version
// used `projectVersioned` with `version: Date.now()`; two recomputes for the
// same tenant in the same millisecond produced EQUAL versions and the
// `#__version < :version` guard silently dropped the fresher count. The
// self-increment is strictly monotonic regardless of which DecisionReadModel
// shards triggered the batch. dashboard-bff projects this row P3 keyed on the
// carried `__version`, which a counter keeps monotonic.
//
// Do NOT switch the version to the stream SequenceNumber: DecisionReadModel rows
// are keyed `Decision#<tenant>#<id>` (per-decision pk), so a tenant's decisions
// land in DIFFERENT stream shards and their SequenceNumbers are NOT comparable
// across shards — max(SequenceNumber) over a multi-decision batch is
// non-monotonic for the per-tenant AdvisoryStatus row (proven: advisory-bff
// integration "recomputes inFlightCount" -> row never written).
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
    const { inFlightCount, generatingCount, failedCount, oldestGeneratingAt } =
      await repo.deriveAdvisoryAggregate(tenantId);
    // System-originated recompute: no end-user request context. RequestContext
    // sentinels are copied onto the row (harmless — keyed/queried by pk/tenantId).
    const ctx: EventContext = {
      tenantId: asTenantId(tenantId),
      userId: asUserId('system'),
      region: process.env.AWS_REGION ?? 'us-east-1',
      eventId: `recompute-${tenantId}-${Date.now()}`,
      eventType: 'ADVISORY_STATUS_RECOMPUTED',
      timestamp: new Date().toISOString(),
      serviceName: 'advisory-bff',
      record: {},
    };
    await executor.execute(
      update('AdvisoryStatus',
        { tenantId, inFlightCount, generatingCount, failedCount, oldestGeneratingAt },
        { add: { __version: 1 }, overrides: { pk: `T#${tenantId}`, sk: 'AdvisoryStatus' } }),
      ctx,
    );
  }
};
