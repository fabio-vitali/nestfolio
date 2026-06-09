export { InvestorCrossDomainEventTypes, InvestorIngestEventTypes } from './events';
export { DepositInitiatedSchema, WithdrawalInitiatedSchema, MandateSchema, ExecutionModeChangedSchema } from './contracts';
export type { DepositInitiated, WithdrawalInitiated, Mandate, ExecutionModeChanged } from './contracts';

/** Mandate level determines whether user confirmation is required. */
export type MandateLevel = 'ADVISORY' | 'DISCRETIONARY';
