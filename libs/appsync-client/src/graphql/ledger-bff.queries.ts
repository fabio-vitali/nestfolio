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

export const LEDGER_POSITION_FIELDS = `
  fragment LedgerPositionFields on LedgerPosition {
    symbol
    quantity
    averageCostBasis
    totalCostBasis
    lastFillPrice
  }
`;

export const LEDGER_PORTFOLIO_FIELDS = `
  fragment LedgerPortfolioFields on LedgerPortfolio {
    positions {
      ...LedgerPositionFields
    }
    cashBalanceCents
    totalValueCents
    positionCount
    snapshotAt
    streamType
  }
  ${LEDGER_POSITION_FIELDS}
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

export const GET_LEDGER_PORTFOLIO = `
  query GetLedgerPortfolio($streamType: StreamType!) {
    getLedgerPortfolio(streamType: $streamType) {
      ...LedgerPortfolioFields
    }
  }
  ${LEDGER_PORTFOLIO_FIELDS}
`;

export const GET_PORTFOLIO_AT = `
  query GetPortfolioAt($streamType: StreamType!, $timestamp: String!) {
    getPortfolioAt(streamType: $streamType, timestamp: $timestamp) {
      ...LedgerPortfolioFields
    }
  }
  ${LEDGER_PORTFOLIO_FIELDS}
`;

export const GET_SIMULATION_COMPARISON = `
  query GetSimulationComparison {
    getSimulationComparison {
      actual {
        totalValueCents
        cashBalanceCents
        positionCount
        totalReturnPercent
        totalReturnCents
      }
      simulated {
        totalValueCents
        cashBalanceCents
        positionCount
        totalReturnPercent
        totalReturnCents
      }
      divergence {
        returnDifferencePercent
        returnDifferenceCents
        positionDifferences {
          symbol
          actualQuantity
          simulatedQuantity
          quantityDifference
          actualValueCents
          simulatedValueCents
        }
        missedDecisions
        totalDecisions
      }
    }
  }
`;

export const GET_TIME_TRAVEL_AVAILABILITY = `
  query GetTimeTravelAvailability {
    getTimeTravelAvailability {
      available
      oldestDate
      latestDate
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
