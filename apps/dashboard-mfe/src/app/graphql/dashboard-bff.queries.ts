// --- Fragments (internal — used via template interpolation) ---

const PORTFOLIO_SUMMARY_FIELDS = `
  fragment PortfolioSummaryFields on PortfolioSummary {
    totalValueCents
    cashBalanceCents
    positionCount
    updatedAt
  }
`;

const POSITION_SNAPSHOT_FIELDS = `
  fragment PositionSnapshotFields on PositionSnapshot {
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
`;

const ACTIVITY_ENTRY_FIELDS = `
  fragment ActivityEntryFields on ActivityEntry {
    activityId
    activityType
    description
    createdAt
    metadata
  }
`;

const ADVISORY_STATUS_FIELDS = `
  fragment AdvisoryStatusFields on AdvisoryStatus {
    pendingDecisionsCount
    generatingCount
    failedCount
    oldestGeneratingAt
    updatedAt
  }
`;

const INVESTOR_SNAPSHOT_FIELDS = `
  fragment InvestorSnapshotFields on InvestorSnapshot {
    goalType
    riskLevel
    operatingMode
    executionMode
    mandateLevel
    onboardedAt
    updatedAt
  }
`;

const DASHBOARD_FIELDS = `
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

export const GET_SIMULATION_SUMMARY = `
  query GetSimulationSummary {
    getSimulationSummary {
      actualTotalValueCents
      simulatedTotalValueCents
      actualReturnPercent
      simulatedReturnPercent
      returnDifferencePercent
      updatedAt
    }
  }
`;

// --- Subscriptions ---

export const ON_DASHBOARD_UPDATE = `
  subscription OnDashboardUpdate($tenantId: ID!) {
    onDashboardUpdate(tenantId: $tenantId) {
      portfolioSummary {
        ...PortfolioSummaryFields
      }
      advisoryStatus {
        ...AdvisoryStatusFields
      }
    }
  }
  ${PORTFOLIO_SUMMARY_FIELDS}
  ${ADVISORY_STATUS_FIELDS}
`;

export const ON_ACTIVITY_UPDATE = `
  subscription OnActivityUpdate($tenantId: ID!) {
    onActivityUpdate(tenantId: $tenantId) {
      activity {
        ...ActivityEntryFields
      }
    }
  }
  ${ACTIVITY_ENTRY_FIELDS}
`;

export const ON_POSITION_UPDATE = `
  subscription OnPositionUpdate($tenantId: ID!) {
    onPositionUpdate(tenantId: $tenantId) {
      position {
        ...PositionSnapshotFields
      }
    }
  }
  ${POSITION_SNAPSHOT_FIELDS}
`;
