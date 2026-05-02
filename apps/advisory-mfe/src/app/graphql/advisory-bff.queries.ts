// --- Fragments (internal — used via template interpolation) ---

const DECISION_FIELDS = `
  fragment DecisionFields on DecisionPacket {
    decisionId
    tenantId
    trigger
    status
    explanation
    proposedTrades {
      symbol
      assetClass
      side
      quantityOrAmountCents
      targetWeightPercent
      rationale
    }
    confirmationRequired
    confirmedAt
    rejectedAt
    rejectionReason
    version
    createdAt
    updatedAt
  }
`;

const AGENT_INVOCATION_FIELDS = `
  fragment AgentInvocationFields on AgentInvocation {
    invocationId
    decisionId
    agentName
    modelId
    inputTokens
    outputTokens
    latencyMs
    status
    errorMessage
    startedAt
    completedAt
  }
`;

const COMPLIANCE_CHECK_FIELDS = `
  fragment ComplianceCheckFields on ComplianceCheck {
    checkId
    decisionId
    level
    ruleName
    result
    details
    checkedAt
  }
`;

// List view selects only the minimum needed for the list UI.
const DECISION_LIST_FIELDS = `
  fragment DecisionListFields on DecisionPacket {
    decisionId
    status
    trigger
    createdAt
  }
`;

// --- Queries ---

export const GET_PENDING_DECISIONS = `
  query GetPendingDecisions($limit: Int, $cursor: String) {
    getPendingDecisions(limit: $limit, cursor: $cursor) {
      items {
        ...DecisionListFields
      }
      nextCursor
    }
  }
  ${DECISION_LIST_FIELDS}
`;

export const GET_DECISION = `
  query GetDecision($decisionId: ID!) {
    getDecision(decisionId: $decisionId) {
      ...DecisionFields
    }
  }
  ${DECISION_FIELDS}
`;

export const GET_AGENT_INVOCATIONS = `
  query GetAgentInvocations($decisionId: ID!) {
    getAgentInvocations(decisionId: $decisionId) {
      ...AgentInvocationFields
    }
  }
  ${AGENT_INVOCATION_FIELDS}
`;

export const GET_COMPLIANCE_CHECKS = `
  query GetComplianceChecks($decisionId: ID!) {
    getComplianceChecks(decisionId: $decisionId) {
      ...ComplianceCheckFields
    }
  }
  ${COMPLIANCE_CHECK_FIELDS}
`;

// --- Mutations ---

export const CONFIRM_DECISION = `
  mutation ConfirmDecision($decisionId: ID!) {
    confirmDecision(decisionId: $decisionId) {
      ...DecisionFields
    }
  }
  ${DECISION_FIELDS}
`;

export const REJECT_DECISION = `
  mutation RejectDecision($decisionId: ID!, $reason: String!) {
    rejectDecision(decisionId: $decisionId, reason: $reason) {
      ...DecisionFields
    }
  }
  ${DECISION_FIELDS}
`;

export const RECORD_EXPLANATION_VIEW = `
  mutation RecordExplanationView($decisionId: ID!) {
    recordExplanationView(decisionId: $decisionId) {
      decisionId
      viewedAt
    }
  }
`;

// --- Subscriptions ---

export const ON_DECISION_UPDATE = `
  subscription OnDecisionUpdate($tenantId: ID!) {
    onDecisionUpdate(tenantId: $tenantId) {
      ...DecisionFields
    }
  }
  ${DECISION_FIELDS}
`;
