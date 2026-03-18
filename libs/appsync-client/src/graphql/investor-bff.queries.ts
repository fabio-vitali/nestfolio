// --- Fragments (internal — used via template interpolation) ---

const GOAL_FIELDS = `
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

const NOTIFICATION_FIELDS = `
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

const MANDATE_FIELDS = `
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

export const SELECT_OPERATING_MODE = `
  mutation SelectOperatingMode($mode: OperatingMode!) {
    selectOperatingMode(mode: $mode) {
      operatingMode
      updatedAt
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
