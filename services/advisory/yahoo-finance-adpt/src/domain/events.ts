import { eventName } from '@nestfolio/event-types';

export const YahooFinanceAdptEventTypes = {
  FETCH_REQUESTED: eventName('FETCH_YAHOO_FINANCE_REQUESTED'),
  YAHOO_FINANCE_UPDATED: eventName('YAHOO_FINANCE_UPDATED'),
} as const;

export interface YahooFinanceArticle {
  ticker: string;
  source: string;
  articles: unknown[];
}
