export interface PositionState {
  readonly symbol: string;
  readonly quantity: number;
  readonly averageCostBasis: number;
  readonly totalCostBasis: number;
  readonly lastFillPrice: number;
}

export interface PortfolioState {
  readonly positions: Readonly<Record<string, PositionState>>;
  readonly cashBalanceCents: number;
  readonly lastEventSequence: number;
}

export const INITIAL_PORTFOLIO_STATE: PortfolioState = {
  positions: {},
  cashBalanceCents: 10_000_000, // $100k starting balance (matches execution-adpt)
  lastEventSequence: 0,
};
