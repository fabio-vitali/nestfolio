export interface Instrument {
  readonly ticker: string;
  readonly name: string;
  readonly assetClass: string;
  readonly region: string;
}

export interface InstrumentUniverseInput {
  readonly assetClass?: string;
}

export interface InstrumentUniverseResult {
  readonly instruments: readonly Instrument[];
  readonly count: number;
  readonly timestamp: string;
}

const APPROVED_INSTRUMENTS: readonly Instrument[] = [
  { ticker: 'SPY', name: 'SPDR S&P 500 ETF', assetClass: 'equity', region: 'US' },
  { ticker: 'QQQ', name: 'Invesco QQQ Trust', assetClass: 'equity', region: 'US' },
  { ticker: 'AGG', name: 'iShares Core U.S. Aggregate Bond ETF', assetClass: 'fixed-income', region: 'US' },
  { ticker: 'GLD', name: 'SPDR Gold Shares', assetClass: 'commodity', region: 'global' },
  { ticker: 'VWO', name: 'Vanguard FTSE Emerging Markets ETF', assetClass: 'equity', region: 'EM' },
  { ticker: 'TLT', name: 'iShares 20+ Year Treasury Bond ETF', assetClass: 'fixed-income', region: 'US' },
  { ticker: 'IWM', name: 'iShares Russell 2000 ETF', assetClass: 'equity', region: 'US' },
  { ticker: 'EFA', name: 'iShares MSCI EAFE ETF', assetClass: 'equity', region: 'intl' },
];

export function getInstrumentUniverse(input: InstrumentUniverseInput = {}): InstrumentUniverseResult {
  const filtered = input.assetClass
    ? APPROVED_INSTRUMENTS.filter((i) => i.assetClass === input.assetClass)
    : APPROVED_INSTRUMENTS;
  return {
    instruments: filtered,
    count: filtered.length,
    timestamp: new Date().toISOString(),
  };
}
