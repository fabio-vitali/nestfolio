import { eventName } from '@nestfolio/event-types';

export const MarketwatchAdptEventTypes = {
  FETCH_REQUESTED: eventName('FETCH_MARKETWATCH_REQUESTED'),
  MARKETWATCH_UPDATED: eventName('MARKETWATCH_UPDATED'),
} as const;

export interface MarketWatchArticle {
  feed: string;
  source: string;
  articles: unknown[];
}
