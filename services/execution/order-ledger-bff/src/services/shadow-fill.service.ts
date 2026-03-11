import { StaticMarketDataProvider, CachedMarketDataProvider, type MarketDataProvider } from '@nestfolio/platform-core';

const provider: MarketDataProvider = new CachedMarketDataProvider(
  new StaticMarketDataProvider(),
  60_000,
);

export interface ProposedTrade {
  readonly symbol: string;
  readonly side: 'BUY' | 'SELL';
  readonly quantity: number;
}

export interface FillResult {
  readonly price: number;
  readonly totalValue: number;
}

export class ShadowFillService {
  async simulateFill(trade: ProposedTrade): Promise<FillResult> {
    const price = await this.getPrice(trade.symbol);
    return {
      price,
      totalValue: trade.quantity * price,
    };
  }

  async getPrice(symbol: string): Promise<number> {
    const quote = await provider.getQuote(symbol);
    return quote?.price ?? 100.0; // default fallback
  }
}
