import { broadcastFromStream } from '@nestfolio/event-processor';

// `tenantId` MUST be in the selection set: AppSync's @aws_subscribe filter
// matches the subscription's `tenantId` argument against fields in the mutation
// RESPONSE (not input args). Without selecting tenantId, the filter never
// matches and the broadcast silently drops on the server side.
const PUBLISH_DASHBOARD_UPDATE = `
  mutation PublishDashboardUpdate($tenantId: ID!, $advisoryStatus: AdvisoryStatusInput, $portfolioSummary: PortfolioSummaryInput, $investorSnapshot: InvestorSnapshotInput) {
    publishDashboardUpdate(tenantId: $tenantId, advisoryStatus: $advisoryStatus, portfolioSummary: $portfolioSummary, investorSnapshot: $investorSnapshot) {
      tenantId
      portfolioSummary {
        totalValueCents
        cashBalanceCents
        positionCount
        updatedAt
      }
      advisoryStatus {
        pendingDecisionsCount
        generatingCount
        failedCount
        oldestGeneratingAt
        updatedAt
      }
      investorSnapshot {
        goalType
        riskLevel
        operatingMode
        executionMode
        mandateLevel
        onboardedAt
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

const PUBLISH_POSITION_UPDATE = `
  mutation PublishPositionUpdate($tenantId: ID!, $position: PositionInput!) {
    publishPositionUpdate(tenantId: $tenantId, position: $position) {
      tenantId
      position {
        symbol
        assetClass
        quantity
        avgCostBasisCents
        currentPriceCents
        marketValueCents
        weightPercent
        unrealizedPnlCents
        updatedAt
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
      whenChanged: ['pendingDecisionsCount', 'generatingCount', 'failedCount', 'oldestGeneratingAt'],
      mapImage: (item) => {
        const tenantId = String(item['pk'] ?? '').slice(2); // 'T#<tenantId>' → '<tenantId>'
        return {
          tenantId,
          advisoryStatus: {
            pendingDecisionsCount: Number(item['pendingDecisionsCount'] ?? 0),
            generatingCount: Number(item['generatingCount'] ?? 0),
            failedCount: Number(item['failedCount'] ?? 0),
            oldestGeneratingAt: item['oldestGeneratingAt'] != null ? String(item['oldestGeneratingAt']) : null,
            updatedAt: String(item['updatedAt'] ?? new Date().toISOString()),
          },
        };
      },
    },
    PortfolioSummary: {
      mutation: PUBLISH_DASHBOARD_UPDATE,
      // skipInsert default false — first PortfolioSummary materialisation also
      // broadcasts. Gate MODIFY on the KPI values (not updatedAt, which always
      // changes) so a no-op snapshot rewrite does not spam the channel.
      whenChanged: ['totalValueCents', 'cashBalanceCents', 'positionCount'],
      mapImage: (item) => {
        const tenantId = String(item['pk'] ?? '').slice(2); // 'T#<tenantId>' → '<tenantId>'
        return {
          tenantId,
          portfolioSummary: {
            totalValueCents: Number(item['totalValueCents'] ?? 0),
            cashBalanceCents: Number(item['cashBalanceCents'] ?? 0),
            positionCount: Number(item['positionCount'] ?? 0),
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
    PositionSnapshot: {
      mutation: PUBLISH_POSITION_UPDATE,
      // One PositionSnapshot row per holding; a fully-exited symbol persists as a
      // quantity:0 ghost row (the read resolver filters quantity>0, and the client
      // mirrors that, so the quantity:0 frame IS the removal signal). Gate MODIFY
      // on the ABSOLUTE fields only — weightPercent is RELATIVE and recomputed
      // client-side, so it changes on every snapshot even for an untouched holding;
      // gating on it would broadcast every row on every event. marketValueCents is
      // in the gate, so every holding whose value actually moves (incl. the
      // quantity>0→0 exit) broadcasts; a sibling-only weight shift does not (the
      // client recomputes that holding's weight locally when the total changes).
      whenChanged: ['quantity', 'avgCostBasisCents', 'currentPriceCents', 'marketValueCents', 'unrealizedPnlCents'],
      mapImage: (item) => {
        const tenantId = String(item['pk'] ?? '').slice(2); // 'T#<tenantId>' → '<tenantId>'
        return {
          tenantId,
          position: {
            symbol: String(item['symbol']),
            assetClass: item['assetClass'] != null ? String(item['assetClass']) : null,
            quantity: Number(item['quantity'] ?? 0),
            avgCostBasisCents: Number(item['avgCostBasisCents'] ?? 0),
            currentPriceCents: Number(item['currentPriceCents'] ?? 0),
            marketValueCents: Number(item['marketValueCents'] ?? 0),
            weightPercent: Number(item['weightPercent'] ?? 0),
            unrealizedPnlCents: Number(item['unrealizedPnlCents'] ?? 0),
            updatedAt: String(item['updatedAt'] ?? new Date().toISOString()),
          },
        };
      },
    },
    InvestorSnapshot: {
      mutation: PUBLISH_DASHBOARD_UPDATE,
      // skipInsert default false — first materialisation also broadcasts (matches
      // AdvisoryStatus / PortfolioSummary). Gate MODIFY on the user-visible display
      // fields only (NOT updatedAt/__version, which change on every projectVersioned
      // write) so a go-live executionMode flip broadcasts but a no-op rewrite does not.
      whenChanged: ['executionMode', 'operatingMode', 'goalType', 'riskLevel', 'mandateLevel'],
      mapImage: (item) => {
        const tenantId = String(item['pk'] ?? '').slice(2); // 'T#<tenantId>' → '<tenantId>'
        const s = (k: string) => (item[k] != null ? String(item[k]) : null);
        return {
          tenantId,
          investorSnapshot: {
            goalType: s('goalType'),
            riskLevel: s('riskLevel'),
            operatingMode: s('operatingMode'),
            executionMode: s('executionMode'),
            mandateLevel: s('mandateLevel'),
            onboardedAt: s('onboardedAt'),
            updatedAt: String(item['updatedAt'] ?? new Date().toISOString()),
          },
        };
      },
    },
  },
});
