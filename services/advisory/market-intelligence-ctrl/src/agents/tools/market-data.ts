export interface MarketDataInput {
  readonly tickers?: readonly string[];
}

export interface MarketIndex {
  readonly ticker: string;
  readonly price: number;
  readonly change: number;
  readonly changePercent: number;
  readonly volume: number;
}

export interface MarketDataResult {
  readonly indices: readonly MarketIndex[];
  readonly volatility: { readonly vix: number };
  readonly timestamp: string;
}

export function getMarketData(input: MarketDataInput = {}): MarketDataResult {
  const tickers = input.tickers ?? ['SPY', 'QQQ', 'DIA', 'IWM'];
  const indices = tickers.map((ticker) => ({
    ticker,
    price: 450 + Math.random() * 50,
    change: (Math.random() - 0.5) * 4,
    changePercent: (Math.random() - 0.5) * 2,
    volume: Math.floor(Math.random() * 10_000_000),
  }));
  return {
    indices,
    volatility: { vix: 15 + Math.random() * 10 },
    timestamp: new Date().toISOString(),
  };
}
