// --- Fragments ---

export const POSITION_FIELDS = `
  fragment PositionFields on Position {
    symbol
    assetClass
    quantity
    averageCostBasisCents
    currentPriceCents
    marketValueCents
    weightPercent
    targetWeightPercent
    unrealizedPnlCents
    lastUpdatedAt
  }
`;

export const PORTFOLIO_FIELDS = `
  fragment PortfolioFields on Portfolio {
    portfolioId
    tenantId
    positions {
      ...PositionFields
    }
    cashBalanceCents
    totalValueCents
    currency
    driftPercent
    lastSnapshotAt
    createdAt
    updatedAt
  }
  ${POSITION_FIELDS}
`;

// --- Queries ---

export const GET_PORTFOLIO = `
  query GetPortfolio {
    getPortfolio {
      ...PortfolioFields
    }
  }
  ${PORTFOLIO_FIELDS}
`;

export const GET_POSITIONS = `
  query GetPositions {
    getPositions {
      ...PositionFields
    }
  }
  ${POSITION_FIELDS}
`;

export const GET_CASH_BALANCE = `
  query GetCashBalance($currency: String) {
    getCashBalance(currency: $currency) {
      currency
      amount
      updatedAt
    }
  }
`;

export const GET_PERFORMANCE = `
  query GetPerformance($period: String!) {
    getPerformance(period: $period) {
      period
      returnPercent
      returnAbsolute
      sharpeRatio
      maxDrawdown
    }
  }
`;

// --- Subscriptions ---

export const ON_PORTFOLIO_UPDATE = `
  subscription OnPortfolioUpdate {
    onPortfolioUpdate {
      ...PortfolioFields
    }
  }
  ${PORTFOLIO_FIELDS}
`;

export const ON_POSITION_UPDATE = `
  subscription OnPositionUpdate {
    onPositionUpdate {
      ...PositionFields
    }
  }
  ${POSITION_FIELDS}
`;
