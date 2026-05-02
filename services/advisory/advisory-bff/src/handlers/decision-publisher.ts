import { broadcastFromStream } from '@nestfolio/event-processor';

const PUBLISH_DECISION_UPDATE = `
  mutation PublishDecisionUpdate(
    $decisionId: ID!
    $tenantId: ID!
    $status: DecisionStatus!
    $explanation: String!
    $proposedTrades: [ProposedTradeInput!]!
    $version: Int!
    $updatedAt: String!
  ) {
    publishDecisionUpdate(
      decisionId: $decisionId
      tenantId: $tenantId
      status: $status
      explanation: $explanation
      proposedTrades: $proposedTrades
      version: $version
      updatedAt: $updatedAt
    ) {
      decisionId
      tenantId
      status
      explanation
      proposedTrades { symbol assetClass side quantityOrAmountCents targetWeightPercent rationale }
      version
      updatedAt
    }
  }
`;

export const handler = broadcastFromStream({
  serviceName: 'advisory-bff',
  appsyncUrl: process.env['APPSYNC_URL'] ?? '',
  region: process.env['AWS_REGION'],
  broadcasts: {
    DecisionReadModel: {
      mutation: PUBLISH_DECISION_UPDATE,
      // skipInsert default false — initial PENDING state lands at clients that
      // subscribed before the SF advanced to AWAITING_CONFIRMATION. Defence
      // against subscribe-before-write race; downstream version-guard in MFE
      // dedupes if the same image arrives via getDecision query.
      whenChanged: ['status', 'explanation', 'proposedTrades', 'version'],
      mapImage: (item) => ({
        decisionId: String(item['decisionId'] ?? ''),
        tenantId: String(item['tenantId'] ?? ''),
        status: String(item['status'] ?? 'PENDING'),
        explanation: String(item['explanation'] ?? ''),
        proposedTrades: Array.isArray(item['proposedTrades']) ? item['proposedTrades'] : [],
        version: Number(item['version'] ?? 0),
        updatedAt: String(item['updatedAt'] ?? new Date().toISOString()),
      }),
    },
  },
});
