// Same static ETF prices as execution-adpt's MarketDataService
const STATIC_PRICES: Record<string, number> = {
  VTI: 250.50,
  VXUS: 58.75,
  BND: 72.30,
  VNQ: 85.40,
  GLD: 195.80,
  SPY: 520.15,
  QQQ: 445.60,
  IWM: 210.25,
  EFA: 78.90,
  EEM: 42.15,
  TLT: 92.50,
  AGG: 98.75,
  VIG: 178.30,
  SCHD: 82.45,
  VOO: 480.20,
  VGSH: 58.10,
  VCIT: 80.55,
  VWO: 43.20,
  IEMG: 52.80,
  XLF: 42.90,
};

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
  simulateFill(trade: ProposedTrade): FillResult {
    const price = STATIC_PRICES[trade.symbol] ?? 100.0;
    return {
      price,
      totalValue: trade.quantity * price,
    };
  }

  getPrice(symbol: string): number {
    return STATIC_PRICES[symbol] ?? 100.0;
  }
}
