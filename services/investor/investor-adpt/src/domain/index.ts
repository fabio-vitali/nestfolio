export { InvestorCrossDomainEventTypes, InvestorIngestEventTypes } from './events';
export { DepositInitiatedSchema, WithdrawalInitiatedSchema } from './contracts';
export type { DepositInitiated, WithdrawalInitiated } from './contracts';

/** Mandate level determines whether user confirmation is required. */
export type MandateLevel = 'ADVISORY' | 'DISCRETIONARY';
