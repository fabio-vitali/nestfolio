import { eventName } from '@nestfolio/event-types';

export const SecEdgarAdptEventTypes = {
  FETCH_REQUESTED: eventName('FETCH_SEC_EDGAR_REQUESTED'),
  SEC_8K_FILED: eventName('SEC_8K_FILED'),
  SEC_PROSPECTUS_UPDATED: eventName('SEC_PROSPECTUS_UPDATED'),
  SEC_10K_UPDATED: eventName('SEC_10K_UPDATED'),
} as const;

export type { SecFiling } from './contracts';
