/* eslint-disable @typescript-eslint/no-explicit-any */
export const handler = async (event: any) => {
  const tickers = event.tickers ?? ['SPY', 'QQQ', 'DIA', 'IWM'];

  const indices = tickers.map((ticker: string) => ({
    ticker,
    price: 450 + Math.random() * 50,
    change: (Math.random() - 0.5) * 4,
    changePercent: (Math.random() - 0.5) * 2,
    volume: Math.floor(Math.random() * 10_000_000),
  }));

  return {
    statusCode: 200,
    body: JSON.stringify({
      indices,
      volatility: { vix: 15 + Math.random() * 10 },
      timestamp: new Date().toISOString(),
    }),
  };
};
