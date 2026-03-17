export { InvestorCrossDomainEventTypes } from './events';
export type { InvestorCrossDomainEventType } from './events';

// Cross-domain subset types (defined locally to avoid circular deps)
// Source of truth: @nestfolio/investor-bff/service → models.ts

/** Operating mode determines the advisory style and risk parameters. */
export type OperatingMode = 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';

/** Mandate level determines whether user confirmation is required. */
export type MandateLevel = 'ADVISORY' | 'DISCRETIONARY';

/** Rebalance cadence for the mandate. */
export type RebalanceCadence = 'WEEKLY' | 'MONTHLY' | 'QUARTERLY';
