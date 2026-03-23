export const FredAdptEventTypes = {
  FETCH_REQUESTED: 'FETCH_FRED_REQUESTED',
  FRED_INDICATORS_UPDATED: 'FRED_INDICATORS_UPDATED',
} as const;

export const FredEntityTypes = ['FredIndicator'] as const;

export interface FredIndicator {
  seriesId: string;
  label: string;
  date: string;
  value: string;
}
