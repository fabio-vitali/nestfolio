// --- Fragments (internal — used via template interpolation) ---

const POSITION_FIELDS = `
  fragment PositionFields on Position {
    symbol
    quantity
    averageCostBasis
    totalCostBasis
    lastFillPrice
  }
`;

const PORTFOLIO_FIELDS = `
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
