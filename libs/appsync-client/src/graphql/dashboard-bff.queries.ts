// --- Fragments ---

export const PORTFOLIO_SUMMARY_FIELDS = `
  fragment PortfolioSummaryFields on PortfolioSummary {
    totalValueCents
    cashBalanceCents
    positionCount
    driftPercent
    updatedAt
  }
`;

export const POSITION_SNAPSHOT_FIELDS = `
  fragment PositionSnapshotFields on PositionSnapshot {
    symbol
    assetClass
    quantity
    avgCostBasisCents
    currentPriceCents
    marketValueCents
    weightPercent
    unrealizedPnlCents
    lastUpdatedAt
  }
`;

export const ACTIVITY_ENTRY_FIELDS = `
  fragment ActivityEntryFields on ActivityEntry {
    activityType
    description
    timestamp
    metadata
  }
`;

export const ADVISORY_STATUS_FIELDS = `
  fragment AdvisoryStatusFields on AdvisoryStatus {
    pendingDecisionsCount
    lastRecommendationAt
    lastDecisionStatus
    updatedAt
  }
`;

export const INVESTOR_SNAPSHOT_FIELDS = `
  fragment InvestorSnapshotFields on InvestorSnapshot {
    goalType
    riskLevel
    operatingMode
    mandateLevel
    onboardedAt
    updatedAt
  }
`;

export const DASHBOARD_FIELDS = `
  fragment DashboardFields on Dashboard {
    portfolioSummary {
      ...PortfolioSummaryFields
    }
    advisoryStatus {
      ...AdvisoryStatusFields
    }
    investorSnapshot {
      ...InvestorSnapshotFields
    }
  }
  ${PORTFOLIO_SUMMARY_FIELDS}
  ${ADVISORY_STATUS_FIELDS}
  ${INVESTOR_SNAPSHOT_FIELDS}
`;

// --- Queries ---

export const GET_DASHBOARD = `
  query GetDashboard {
    getDashboard {
      ...DashboardFields
    }
  }
  ${DASHBOARD_FIELDS}
`;

export const GET_POSITION_SNAPSHOTS = `
  query GetPositionSnapshots {
    getPositionSnapshots {
      ...PositionSnapshotFields
    }
  }
  ${POSITION_SNAPSHOT_FIELDS}
`;

export const GET_RECENT_ACTIVITY = `
  query GetRecentActivity($limit: Int) {
    getRecentActivity(limit: $limit) {
      ...ActivityEntryFields
    }
  }
  ${ACTIVITY_ENTRY_FIELDS}
`;

// --- Subscriptions ---

export const ON_DASHBOARD_UPDATE = `
  subscription OnDashboardUpdate {
    onDashboardUpdate {
      ...DashboardFields
    }
  }
  ${DASHBOARD_FIELDS}
`;
