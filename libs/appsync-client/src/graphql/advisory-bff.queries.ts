// --- Fragments ---

export const DECISION_FIELDS = `
  fragment DecisionFields on Decision {
    decisionId
    tenantId
    status
    rationale
    proposedActions {
      actionType
      symbol
      side
      quantity
      limitPrice
      currency
    }
    complianceStatus
    confirmedAt
    confirmedBy
    rejectedAt
    rejectionReason
    rejectedBy
    version
    createdAt
    updatedAt
  }
`;

export const AGENT_INVOCATION_FIELDS = `
  fragment AgentInvocationFields on AgentInvocation {
    invocationId
    decisionId
    agentName
    tier
    input
    output
    durationMs
    status
    invokedAt
  }
`;

export const COMPLIANCE_CHECK_FIELDS = `
  fragment ComplianceCheckFields on ComplianceCheck {
    checkId
    decisionId
    ruleName
    result
    details
    checkedAt
  }
`;

// --- Queries ---

export const GET_DECISION = `
  query GetDecision($decisionId: ID!) {
    getDecision(decisionId: $decisionId) {
      ...DecisionFields
    }
  }
  ${DECISION_FIELDS}
`;

export const GET_PENDING_DECISIONS = `
  query GetPendingDecisions($limit: Int, $cursor: String) {
    getPendingDecisions(limit: $limit, cursor: $cursor) {
      items {
        ...DecisionFields
      }
      nextCursor
    }
  }
  ${DECISION_FIELDS}
`;

export const GET_DECISION_HISTORY = `
  query GetDecisionHistory($limit: Int, $cursor: String) {
    getDecisionHistory(limit: $limit, cursor: $cursor) {
      items {
        ...DecisionFields
      }
      nextCursor
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
  subscription OnDecisionUpdate {
    onDecisionUpdate {
      ...DecisionFields
    }
  }
  ${DECISION_FIELDS}
`;
