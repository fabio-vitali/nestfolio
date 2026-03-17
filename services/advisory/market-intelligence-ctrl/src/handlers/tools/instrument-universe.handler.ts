/* eslint-disable @typescript-eslint/no-explicit-any */
const APPROVED_INSTRUMENTS = [
  { ticker: 'SPY', name: 'SPDR S&P 500 ETF', assetClass: 'equity', region: 'US' },
  { ticker: 'QQQ', name: 'Invesco QQQ Trust', assetClass: 'equity', region: 'US' },
  { ticker: 'AGG', name: 'iShares Core U.S. Aggregate Bond ETF', assetClass: 'fixed-income', region: 'US' },
  { ticker: 'GLD', name: 'SPDR Gold Shares', assetClass: 'commodity', region: 'global' },
  { ticker: 'VWO', name: 'Vanguard FTSE Emerging Markets ETF', assetClass: 'equity', region: 'EM' },
  { ticker: 'TLT', name: 'iShares 20+ Year Treasury Bond ETF', assetClass: 'fixed-income', region: 'US' },
  { ticker: 'IWM', name: 'iShares Russell 2000 ETF', assetClass: 'equity', region: 'US' },
  { ticker: 'EFA', name: 'iShares MSCI EAFE ETF', assetClass: 'equity', region: 'intl' },
];

export const handler = async (event: any) => {
  const assetClass = event.assetClass as string | undefined;
  const filtered = assetClass
    ? APPROVED_INSTRUMENTS.filter((i) => i.assetClass === assetClass)
    : APPROVED_INSTRUMENTS;

  return {
    statusCode: 200,
    body: JSON.stringify({
      instruments: filtered,
      count: filtered.length,
      timestamp: new Date().toISOString(),
    }),
  };
};
