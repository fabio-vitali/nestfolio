import { broadcastFromStream } from '@nestfolio/event-processor';

const APPSYNC_URL = process.env['APPSYNC_URL'];
if (!APPSYNC_URL) {
  throw new Error('decision-publisher: APPSYNC_URL is required');
}

const PUBLISH_DECISION_UPDATE = `
  mutation PublishDecisionUpdate(
    $decisionId: ID!
    $tenantId: ID!
    $status: DecisionStatus!
    $trigger: String!
    $explanation: String!
    $proposedTrades: [ProposedTradeInput!]!
    $version: Int!
    $createdAt: String!
    $updatedAt: String!
    $confirmationRequired: Boolean
    $confirmedAt: String
    $rejectedAt: String
    $rejectionReason: String
  ) {
    publishDecisionUpdate(
      decisionId: $decisionId
      tenantId: $tenantId
      status: $status
      trigger: $trigger
      explanation: $explanation
      proposedTrades: $proposedTrades
      version: $version
      createdAt: $createdAt
      updatedAt: $updatedAt
      confirmationRequired: $confirmationRequired
      confirmedAt: $confirmedAt
      rejectedAt: $rejectedAt
      rejectionReason: $rejectionReason
    ) {
      decisionId
      tenantId
      status
      trigger
      explanation
      proposedTrades { symbol assetClass side quantityOrAmountCents targetWeightPercent rationale }
      version
      createdAt
      updatedAt
      confirmationRequired
      confirmedAt
      rejectedAt
      rejectionReason
    }
  }
`;

export const handler = broadcastFromStream({
  serviceName: 'advisory-bff',
  appsyncUrl: APPSYNC_URL,
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
        status: String(item['status'] ?? ''),
        trigger: String(item['trigger'] ?? ''),
        explanation: String(item['explanation'] ?? ''),
        proposedTrades: Array.isArray(item['proposedTrades']) ? item['proposedTrades'] : [],
        version: Number(item['version'] ?? 0),
        createdAt: String(item['createdAt'] ?? ''),
        updatedAt: String(item['updatedAt'] ?? new Date().toISOString()),
        confirmationRequired: typeof item['confirmationRequired'] === 'boolean' ? item['confirmationRequired'] : false,
        confirmedAt: typeof item['confirmedAt'] === 'string' ? item['confirmedAt'] : null,
        rejectedAt: typeof item['rejectedAt'] === 'string' ? item['rejectedAt'] : null,
        rejectionReason: typeof item['rejectionReason'] === 'string' ? item['rejectionReason'] : null,
      }),
    },
  },
});
