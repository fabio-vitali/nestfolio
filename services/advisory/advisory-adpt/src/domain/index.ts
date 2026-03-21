export { AdvisoryCrossDomainEventTypes } from './events';

/** A proposed trade within a decision packet. */
export interface ProposedTrade {
  readonly symbol: string;
  readonly assetClass: string;
  readonly side: 'BUY' | 'SELL';
  readonly quantityOrAmountCents: number;
  readonly targetWeightPercent: number;
  readonly rationale: string;
}
