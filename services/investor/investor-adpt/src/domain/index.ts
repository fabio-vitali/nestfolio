export { InvestorCrossDomainEventTypes, InvestorIngestEventTypes } from './events';
export { DepositInitiatedSubjectSchema, WithdrawalInitiatedSubjectSchema } from './contracts';
export type { DepositInitiatedSubject, WithdrawalInitiatedSubject } from './contracts';

/** Mandate level determines whether user confirmation is required. */
export type MandateLevel = 'ADVISORY' | 'DISCRETIONARY';
