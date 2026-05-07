// --- Fragments (internal — used via template interpolation) ---

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

// --- Deposit ---

const DEPOSIT_FIELDS = `
  fragment DepositFields on Deposit {
    depositId
    amountCents
    currency
    status
    initiatedAt
    detectedAt
    failedAt
    reason
  }
`;

export const GET_DEPOSIT = `
  query GetDeposit($depositId: ID!) {
    getDeposit(depositId: $depositId) {
      ...DepositFields
    }
  }
  ${DEPOSIT_FIELDS}
`;
