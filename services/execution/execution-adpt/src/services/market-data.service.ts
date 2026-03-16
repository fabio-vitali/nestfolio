import { StaticMarketDataProvider, CachedMarketDataProvider, KNOWN_SYMBOLS, type MarketDataProvider } from '@nestfolio/event-processor';

const provider: MarketDataProvider = new CachedMarketDataProvider(
  new StaticMarketDataProvider(),
  60_000, // 1 min TTL for execution
);

export class MarketDataService {
  async getPrice(symbol: string): Promise<number | null> {
    const quote = await provider.getQuote(symbol);
    return quote?.price ?? null;
  }

  async getAllPrices(): Promise<Record<string, number>> {
    const quotes = await Promise.all(KNOWN_SYMBOLS.map(s => provider.getQuote(s)));
    const prices: Record<string, number> = {};
    quotes.forEach((quote, i) => {
      if (quote) prices[KNOWN_SYMBOLS[i]] = quote.price;
    });
    return prices;
  }
}
