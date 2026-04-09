import { eventName } from '@nestfolio/event-types';

export const SecEdgarAdptEventTypes = {
  FETCH_REQUESTED: eventName('FETCH_SEC_EDGAR_REQUESTED'),
  SEC_8K_FILED: eventName('SEC_8K_FILED'),
  SEC_PROSPECTUS_UPDATED: eventName('SEC_PROSPECTUS_UPDATED'),
  SEC_10K_UPDATED: eventName('SEC_10K_UPDATED'),
} as const;

export interface SecFiling {
  readonly pk: string;
  readonly sk: string;
  readonly __typename: 'SecFiling';
  readonly cik: string;
  readonly issuer: string;
  readonly formType: string;
  readonly filingDate: string;
  readonly accessionNumber: string;
  readonly body: string;
  readonly source: 'sec-edgar';
  readonly fetchedAt: string;
}
