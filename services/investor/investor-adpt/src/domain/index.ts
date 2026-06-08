export { InvestorCrossDomainEventTypes, InvestorIngestEventTypes } from './events';
export { FundingSnapshotSchema } from './contracts';
export type { FundingSnapshot } from './contracts';

/** Mandate level determines whether user confirmation is required. */
export type MandateLevel = 'ADVISORY' | 'DISCRETIONARY';
