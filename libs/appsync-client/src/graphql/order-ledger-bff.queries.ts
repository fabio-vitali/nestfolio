// --- Fragments ---

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
