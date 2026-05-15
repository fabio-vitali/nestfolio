import { StaticMarketDataProvider, CachedMarketDataProvider, type MarketDataProvider } from '@nestfolio/event-processor';

const provider: MarketDataProvider = new CachedMarketDataProvider(
  new StaticMarketDataProvider(),
  60_000,
);

export interface ProposedTrade {
  readonly symbol: string;
  readonly side: 'BUY' | 'SELL';
  readonly quantityOrAmountCents: number;
}

export interface FillResult {
  readonly price: number;
  readonly derivedQuantity: number;
  readonly totalValue: number;
}

export class ShadowFillService {
  async simulateFill(trade: ProposedTrade): Promise<FillResult> {
    const price = await this.getPrice(trade.symbol);
    const totalValue = trade.quantityOrAmountCents / 100;
    const derivedQuantity = totalValue / price;
    return { price, derivedQuantity, totalValue };
  }

  async getPrice(symbol: string): Promise<number> {
    const quote = await provider.getQuote(symbol);
    return quote?.price ?? 100.0; // default fallback
  }
}
