// Handler for AgentCore Gateway tool: market-data
// Uses shared MarketDataProvider for consistent data across services
import { logger, StaticMarketDataProvider, CachedMarketDataProvider, type MarketDataProvider } from '@nestfolio/event-processor';

const provider: MarketDataProvider = new CachedMarketDataProvider(
  new StaticMarketDataProvider(),
  300_000, // 5 min TTL for advisory
);

export const handler = async (_event: Record<string, unknown>): Promise<unknown> => {
  logger.info('Market data lookup');

  const [indices, rates] = await Promise.all([
    provider.getIndices(),
    provider.getRates(),
  ]);

  return {
    majorIndices: indices,
    interestRates: Object.fromEntries(rates.map(r => [r.rateType, r.value])),
    volatilityIndex: 16.5, // Keep static for now
    recentEvents: [],
    dataTimestamp: new Date().toISOString(),
  };
};
