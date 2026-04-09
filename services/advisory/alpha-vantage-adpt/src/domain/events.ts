import { eventName } from '@nestfolio/event-types';

export const AlphaVantageAdptEventTypes = {
  FETCH_REQUESTED: eventName('FETCH_ALPHA_VANTAGE_REQUESTED'),
  ALPHA_VANTAGE_NEWS_UPDATED: eventName('ALPHA_VANTAGE_NEWS_UPDATED'),
  ECONOMIC_INDICATOR_UPDATED: eventName('ALPHA_VANTAGE_ECONOMIC_INDICATOR_UPDATED'),
} as const;
