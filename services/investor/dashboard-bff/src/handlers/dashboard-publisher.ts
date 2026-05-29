import { broadcastFromStream } from '@nestfolio/event-processor';

// `tenantId` MUST be in the selection set: AppSync's @aws_subscribe filter
// matches the subscription's `tenantId` argument against fields in the mutation
// RESPONSE (not input args). Without selecting tenantId, the filter never
// matches and the broadcast silently drops on the server side.
const PUBLISH_DASHBOARD_UPDATE = `
  mutation PublishDashboardUpdate($tenantId: ID!, $advisoryStatus: AdvisoryStatusInput) {
    publishDashboardUpdate(tenantId: $tenantId, advisoryStatus: $advisoryStatus) {
      tenantId
      advisoryStatus {
        pendingDecisionsCount
        lastRecommendationAt
        lastDecisionStatus
        updatedAt
      }
    }
  }
`;

const PUBLISH_ACTIVITY_UPDATE = `
  mutation PublishActivityUpdate($tenantId: ID!, $activity: ActivityEntryInput!) {
    publishActivityUpdate(tenantId: $tenantId, activity: $activity) {
      tenantId
      activity {
        activityId
        activityType
        description
        createdAt
        metadata
      }
    }
  }
`;

const APPSYNC_URL = process.env['APPSYNC_URL'];
if (!APPSYNC_URL) {
  throw new Error('dashboard-publisher: APPSYNC_URL is required');
}

export const handler = broadcastFromStream({
  serviceName: 'dashboard-bff',
  appsyncUrl: APPSYNC_URL,
  region: process.env['AWS_REGION'],
  broadcasts: {
    AdvisoryStatus: {
      mutation: PUBLISH_DASHBOARD_UPDATE,
      // skipInsert default false — first AdvisoryStatus materialisation also
      // broadcasts (matches pre-migration semantics: the prior handler fired on
      // both INSERT and MODIFY without a change-gate).
      whenChanged: ['pendingDecisionsCount', 'lastRecommendationAt', 'lastDecisionStatus'],
      mapImage: (item) => {
        const tenantId = String(item['pk'] ?? '').slice(2); // 'T#<tenantId>' → '<tenantId>'
        return {
          tenantId,
          advisoryStatus: {
            pendingDecisionsCount: Number(item['pendingDecisionsCount'] ?? 0),
            lastRecommendationAt: item['lastRecommendationAt'] ?? null,
            lastDecisionStatus: item['lastDecisionStatus'] ?? null,
            updatedAt: String(item['updatedAt'] ?? new Date().toISOString()),
          },
        };
      },
    },
    Activity: {
      mutation: PUBLISH_ACTIVITY_UPDATE,
      // skipInsert default false — Activity rows are INSERT-only; the first
      // emit IS the signal. No whenChanged: every Activity insert broadcasts.
      mapImage: (item) => {
        const tenantId = String(item['pk'] ?? '').slice(2); // 'T#<id>' → '<id>'
        return {
          tenantId,
          activity: {
            activityId: String(item['activityId']),
            activityType: String(item['activityType']),
            description: String(item['description']),
            createdAt: String(item['createdAt']),
            metadata: item['metadata'] != null ? String(item['metadata']) : null,
          },
        };
      },
    },
  },
});
