// Handler for AgentCore Gateway tool: market-data
// Returns market data (stubbed for Phase 3 - will integrate with real data sources later)
import { logger } from '@nestfolio/platform-core';

export const handler = async (_event: Record<string, unknown>): Promise<unknown> => {
  logger.info('Market data lookup');

  return {
    majorIndices: [
      { name: 'S&P 500', ticker: 'SPX', value: 5200, change: 0.003 },
      { name: 'NASDAQ', ticker: 'NDX', value: 18500, change: 0.005 },
      { name: 'Russell 2000', ticker: 'RUT', value: 2100, change: -0.001 },
    ],
    volatilityIndex: 16.5,
    interestRates: { fed: 4.25, treasury10Y: 4.10, treasury2Y: 3.95 },
    recentEvents: [],
    dataTimestamp: new Date().toISOString(),
  };
};
