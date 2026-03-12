export interface PositionState {
  readonly symbol: string;
  readonly quantity: number;
  readonly averageCostBasis: number;
  readonly totalCostBasis: number;
  readonly lastFillPrice: number;
}

export interface AccountState {
  readonly positions: Readonly<Record<string, PositionState>>;
  readonly cashBalanceCents: number;
  readonly lastEventSequence: number;
}

export const INITIAL_ACCOUNT_STATE: AccountState = {
  positions: {},
  cashBalanceCents: 10_000_000,
  lastEventSequence: 0,
};
