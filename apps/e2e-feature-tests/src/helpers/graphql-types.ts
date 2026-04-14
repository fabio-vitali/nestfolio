/** Shared GraphQL response types used across multiple E2E scenarios. */

export interface DecisionHistoryResponse {
  getDecisionHistory: {
    items: Array<{ decisionId: string; trigger: string; status: string }>;
    nextCursor: string | null;
  };
}

export interface RecentActivityResponse {
  getRecentActivity: Array<{
    activityType: string;
    description: string;
    createdAt: string;
    metadata: string | null;
  }>;
}
