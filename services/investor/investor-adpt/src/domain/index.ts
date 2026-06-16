export { InvestorCrossDomainEventTypes, InvestorIngestEventTypes } from './events';
export { DepositInitiatedSchema, WithdrawalInitiatedSchema, MandateSchema, ExecutionModeChangedSchema, mandateEventSubjects } from './contracts';
export type { DepositInitiated, WithdrawalInitiated, Mandate, ExecutionModeChanged } from './contracts';

// Cross-domain re-export: INVESTOR_PROFILE_UPDATED is produced by investor-bff and
// consumed by the advisory domain (investor-profile-ctrl snapshot rebuild). Per the
// home rule, a cross-domain consumer imports the producer's contract through the
// producer's domain adapter. investor-bff owns the schema (intra-investor producer);
// this adapter re-exports it so advisory parses against the producer-owned source.
export { InvestorProfileUpdatedSchema } from '@nestfolio/investor-bff/contracts';
export type { InvestorProfileUpdated } from '@nestfolio/investor-bff/contracts';

/** Mandate level determines whether user confirmation is required. */
export type MandateLevel = 'ADVISORY' | 'DISCRETIONARY';
