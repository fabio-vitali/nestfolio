// --- Fragments ---

export const PROFILE_FIELDS = `
  fragment ProfileFields on InvestorProfile {
    tenantId
    name
    email
    age
    locale
    operatingMode
    riskProfile {
      profileId
      tenantId
      score
      band { minEquity maxEquity }
      assessedAt
      version
    }
    goals {
      goalId
      tenantId
      objective
      targetAmountCents
      currency
      timeHorizonMonths
      targetReturn
      createdAt
      updatedAt
    }
    mandate {
      mandateId
      tenantId
      level
      monthlyTurnoverCapPercent
      maxSingleTradePercent
      coolDownDays
      rebalanceCadence
      effectiveDate
      revokedAt
      version
    }
    monthlyContributionCents
    currency
    onboardingCompletedAt
    createdAt
    updatedAt
  }
`;

export const GOAL_FIELDS = `
  fragment GoalFields on Goal {
    goalId
    tenantId
    objective
    targetAmountCents
    currency
    timeHorizonMonths
    targetReturn
    createdAt
    updatedAt
  }
`;

export const NOTIFICATION_FIELDS = `
  fragment NotificationFields on Notification {
    notificationId
    tenantId
    channel
    title
    body
    status
    relatedEntityType
    relatedEntityId
    createdAt
    sentAt
    deliveredAt
    readAt
  }
`;

export const MANDATE_FIELDS = `
  fragment MandateFields on Mandate {
    mandateId
    tenantId
    level
    monthlyTurnoverCapPercent
    maxSingleTradePercent
    coolDownDays
    rebalanceCadence
    effectiveDate
    revokedAt
    version
  }
`;

// --- Queries ---

export const GET_PROFILE = `
  query GetProfile {
    getProfile {
      ...ProfileFields
    }
  }
  ${PROFILE_FIELDS}
`;

export const GET_GOALS = `
  query GetGoals {
    getGoals {
      ...GoalFields
    }
  }
  ${GOAL_FIELDS}
`;

export const GET_NOTIFICATIONS = `
  query GetNotifications($limit: Int, $cursor: String) {
    getNotifications(limit: $limit, cursor: $cursor) {
      items {
        ...NotificationFields
      }
      nextCursor
    }
  }
  ${NOTIFICATION_FIELDS}
`;

export const GET_UNREAD_COUNT = `
  query GetUnreadCount {
    getUnreadCount
  }
`;

// --- Mutations ---

export const RECORD_ONBOARDING_ANSWER = `
  mutation RecordOnboardingAnswer($input: OnboardingAnswerInput!) {
    recordOnboardingAnswer(input: $input) {
      step
      answeredAt
    }
  }
`;

export const SET_GOAL = `
  mutation SetGoal($input: GoalInput!) {
    setGoal(input: $input) {
      ...GoalFields
    }
  }
  ${GOAL_FIELDS}
`;

export const UPDATE_GOAL = `
  mutation UpdateGoal($goalId: ID!, $input: GoalInput!) {
    updateGoal(goalId: $goalId, input: $input) {
      ...GoalFields
    }
  }
  ${GOAL_FIELDS}
`;

export const SET_RISK_PROFILE = `
  mutation SetRiskProfile($input: RiskProfileInput!) {
    setRiskProfile(input: $input) {
      profileId
      tenantId
      score
      band { minEquity maxEquity }
      assessedAt
      version
    }
  }
`;

export const GRANT_MANDATE = `
  mutation GrantMandate($input: MandateInput!) {
    grantMandate(input: $input) {
      ...MandateFields
    }
  }
  ${MANDATE_FIELDS}
`;

export const UPDATE_MANDATE = `
  mutation UpdateMandate($input: MandateInput!) {
    updateMandate(input: $input) {
      ...MandateFields
    }
  }
  ${MANDATE_FIELDS}
`;

export const REVOKE_MANDATE = `
  mutation RevokeMandate {
    revokeMandate {
      ...MandateFields
    }
  }
  ${MANDATE_FIELDS}
`;

export const SELECT_OPERATING_MODE = `
  mutation SelectOperatingMode($mode: OperatingMode!) {
    selectOperatingMode(mode: $mode) {
      operatingMode
      updatedAt
    }
  }
`;

export const INITIATE_DEPOSIT = `
  mutation InitiateDeposit($input: DepositInput!) {
    initiateDeposit(input: $input) {
      depositId
      amountCents
      currency
      status
      initiatedAt
    }
  }
`;

export const REQUEST_WITHDRAWAL = `
  mutation RequestWithdrawal($input: WithdrawalInput!) {
    requestWithdrawal(input: $input) {
      withdrawalId
      amountCents
      currency
      status
      requestedAt
    }
  }
`;

export const REQUEST_ACCOUNT_CLOSURE = `
  mutation RequestAccountClosure {
    requestAccountClosure {
      closureId
      status
      requestedAt
    }
  }
`;

export const MARK_NOTIFICATION_READ = `
  mutation MarkNotificationRead($notificationId: ID!) {
    markNotificationRead(notificationId: $notificationId) {
      ...NotificationFields
    }
  }
  ${NOTIFICATION_FIELDS}
`;

// --- Subscriptions ---

export const ON_NOTIFICATION = `
  subscription OnNotification {
    onNotification {
      ...NotificationFields
    }
  }
  ${NOTIFICATION_FIELDS}
`;
