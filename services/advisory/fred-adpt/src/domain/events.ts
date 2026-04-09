import { eventName } from '@nestfolio/event-types';

export const FredAdptEventTypes = {
  FETCH_REQUESTED: eventName('FETCH_FRED_REQUESTED'),
  FRED_INDICATORS_UPDATED: eventName('FRED_INDICATORS_UPDATED'),
} as const;

export interface FredIndicator {
  seriesId: string;
  label: string;
  date: string;
  value: string;
}
