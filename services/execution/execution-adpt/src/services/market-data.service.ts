// Hardcoded prices for ~20 major ETFs — sufficient for Phase 2 simulation
const STATIC_PRICES: Record<string, number> = {
  VTI: 250.50,   // Vanguard Total Stock Market
  VXUS: 58.75,   // Vanguard Total International Stock
  BND: 72.30,    // Vanguard Total Bond Market
  VNQ: 85.40,    // Vanguard Real Estate
  GLD: 195.80,   // SPDR Gold
  SPY: 520.15,   // S&P 500
  QQQ: 445.60,   // Nasdaq 100
  IWM: 210.25,   // Russell 2000
  EFA: 78.90,    // iShares MSCI EAFE
  EEM: 42.15,    // iShares MSCI Emerging Markets
  TLT: 92.50,    // iShares 20+ Year Treasury
  AGG: 98.75,    // iShares Core US Aggregate Bond
  VIG: 178.30,   // Vanguard Dividend Appreciation
  SCHD: 82.45,   // Schwab US Dividend Equity
  VOO: 480.20,   // Vanguard S&P 500
  VGSH: 58.10,   // Vanguard Short-Term Treasury
  VCIT: 80.55,   // Vanguard Intermediate-Term Corporate Bond
  VWO: 43.20,    // Vanguard FTSE Emerging Markets
  IEMG: 52.80,   // iShares Core MSCI Emerging Markets
  XLF: 42.90,    // Financial Select Sector SPDR
};

export class MarketDataService {
  getPrice(symbol: string): number | null {
    return STATIC_PRICES[symbol] ?? null;
  }

  getAllPrices(): Record<string, number> {
    return { ...STATIC_PRICES };
  }
}
