export interface Quote {
  readonly symbol: string;
  readonly price: number;
  readonly change: number;
  readonly changePercent: number;
  readonly volume: number;
  readonly timestamp: string;
}

export interface IndexData {
  readonly name: string;
  readonly ticker: string;
  readonly value: number;
  readonly change: number;
}

export interface RateData {
  readonly rateType: string;
  readonly value: number;
  readonly asOf: string;
}

export interface MarketDataProvider {
  getQuote(symbol: string): Promise<Quote | null>;
  getIndices(): Promise<IndexData[]>;
  getRates(): Promise<RateData[]>;
}

const STATIC_QUOTES: Record<string, Omit<Quote, 'timestamp'>> = {
  VTI:  { symbol: 'VTI',  price: 250.50, change: 1.25,  changePercent: 0.50,  volume: 5_200_000 },
  VXUS: { symbol: 'VXUS', price: 58.75,  change: -0.30, changePercent: -0.51, volume: 3_100_000 },
  BND:  { symbol: 'BND',  price: 72.30,  change: 0.10,  changePercent: 0.14,  volume: 4_800_000 },
  VNQ:  { symbol: 'VNQ',  price: 85.40,  change: 0.65,  changePercent: 0.77,  volume: 1_900_000 },
  GLD:  { symbol: 'GLD',  price: 195.80, change: 2.10,  changePercent: 1.08,  volume: 7_300_000 },
  SPY:  { symbol: 'SPY',  price: 520.15, change: 1.56,  changePercent: 0.30,  volume: 42_000_000 },
  QQQ:  { symbol: 'QQQ',  price: 445.60, change: 2.23,  changePercent: 0.50,  volume: 28_000_000 },
  IWM:  { symbol: 'IWM',  price: 210.25, change: -0.42, changePercent: -0.20, volume: 15_000_000 },
  EFA:  { symbol: 'EFA',  price: 78.90,  change: 0.32,  changePercent: 0.41,  volume: 8_500_000 },
  EEM:  { symbol: 'EEM',  price: 42.15,  change: -0.18, changePercent: -0.43, volume: 12_000_000 },
  TLT:  { symbol: 'TLT',  price: 92.50,  change: 0.45,  changePercent: 0.49,  volume: 9_200_000 },
  AGG:  { symbol: 'AGG',  price: 98.75,  change: 0.08,  changePercent: 0.08,  volume: 5_600_000 },
  VIG:  { symbol: 'VIG',  price: 178.30, change: 0.89,  changePercent: 0.50,  volume: 2_300_000 },
  SCHD: { symbol: 'SCHD', price: 82.45,  change: 0.41,  changePercent: 0.50,  volume: 3_800_000 },
  VOO:  { symbol: 'VOO',  price: 480.20, change: 1.44,  changePercent: 0.30,  volume: 6_700_000 },
  VGSH: { symbol: 'VGSH', price: 58.10,  change: 0.02,  changePercent: 0.03,  volume: 2_100_000 },
  VCIT: { symbol: 'VCIT', price: 80.55,  change: 0.12,  changePercent: 0.15,  volume: 1_500_000 },
  VWO:  { symbol: 'VWO',  price: 43.20,  change: -0.22, changePercent: -0.51, volume: 6_400_000 },
  IEMG: { symbol: 'IEMG', price: 52.80,  change: -0.15, changePercent: -0.28, volume: 9_800_000 },
  XLF:  { symbol: 'XLF',  price: 42.90,  change: 0.34,  changePercent: 0.80,  volume: 18_000_000 },
  BNDX: { symbol: 'BNDX', price: 48.60,  change: 0.05,  changePercent: 0.10,  volume: 1_200_000 },
  VTIP: { symbol: 'VTIP', price: 49.25,  change: 0.03,  changePercent: 0.06,  volume: 1_000_000 },
};

const STATIC_INDICES: IndexData[] = [
  { name: 'S&P 500',     ticker: 'SPX', value: 5200,  change: 0.003 },
  { name: 'NASDAQ',       ticker: 'NDX', value: 18500, change: 0.005 },
  { name: 'Russell 2000', ticker: 'RUT', value: 2100,  change: -0.001 },
  { name: 'Dow Jones',    ticker: 'DJI', value: 39200, change: 0.002 },
];

const STATIC_RATES: RateData[] = [
  { rateType: 'fed',         value: 4.25, asOf: '2026-03-01' },
  { rateType: 'treasury10Y', value: 4.10, asOf: '2026-03-01' },
  { rateType: 'treasury2Y',  value: 3.95, asOf: '2026-03-01' },
  { rateType: 'treasury30Y', value: 4.30, asOf: '2026-03-01' },
];

export const KNOWN_SYMBOLS: string[] = Object.keys(STATIC_QUOTES);

export class StaticMarketDataProvider implements MarketDataProvider {
  async getQuote(symbol: string): Promise<Quote | null> {
    const quote = STATIC_QUOTES[symbol];
    if (!quote) return null;
    return { ...quote, timestamp: new Date().toISOString() };
  }

  async getIndices(): Promise<IndexData[]> {
    return [...STATIC_INDICES];
  }

  async getRates(): Promise<RateData[]> {
    return [...STATIC_RATES];
  }
}
