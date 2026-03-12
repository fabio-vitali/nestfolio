// --- Fragments ---

export const POSITION_FIELDS = `
  fragment PositionFields on Position {
    symbol
    quantity
    averageCostBasis
    totalCostBasis
    lastFillPrice
  }
`;

export const PORTFOLIO_FIELDS = `
  fragment PortfolioFields on Portfolio {
    cashBalanceCents
    totalValueCents
    positions {
      ...PositionFields
    }
  }
  ${POSITION_FIELDS}
`;

// --- Queries ---

export const GET_BALANCE = `
  query GetBalance {
    getBalance {
      cashBalanceCents
    }
  }
`;

export const GET_PORTFOLIO = `
  query GetPortfolio {
    getPortfolio {
      ...PortfolioFields
    }
  }
  ${PORTFOLIO_FIELDS}
`;

export const GET_POSITIONS = `
  query GetPositions($symbol: String) {
    getPositions(symbol: $symbol) {
      ...PositionFields
    }
  }
  ${POSITION_FIELDS}
`;

export const GET_PERFORMANCE = `
  query GetPerformance {
    getPerformance {
      totalValueCents
      cashBalanceCents
      investedValueCents
      returnPercent
    }
  }
`;

export const GET_ORDER_HISTORY = `
  query GetOrderHistory($limit: Int, $nextToken: String) {
    getOrderHistory(limit: $limit, nextToken: $nextToken) {
      items {
        eventType
        payload
        timestamp
        sequenceNo
      }
      nextToken
    }
  }
`;

export const GET_TIME_TRAVEL_AVAILABILITY = `
  query GetTimeTravelAvailability {
    getTimeTravelAvailability {
      earliestDate
      latestDate
    }
  }
`;

export const GET_PORTFOLIO_AT = `
  query GetPortfolioAt($timestamp: String!) {
    getPortfolioAt(timestamp: $timestamp) {
      ...PortfolioFields
    }
  }
  ${PORTFOLIO_FIELDS}
`;

export const GET_SIMULATION_COMPARISON = `
  query GetSimulationComparison {
    getSimulationComparison {
      actual {
        ...PortfolioFields
      }
      simulated {
        ...PortfolioFields
      }
      cashDeltaCents
      positionDiffs {
        symbol
        actualQuantity
        simulatedQuantity
        quantityDiff
      }
    }
  }
  ${PORTFOLIO_FIELDS}
`;
