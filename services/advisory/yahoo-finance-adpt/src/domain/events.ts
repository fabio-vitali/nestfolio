export const YahooFinanceAdptEventTypes = {
  FETCH_REQUESTED: 'FETCH_YAHOO_FINANCE_REQUESTED',
  YAHOO_FINANCE_UPDATED: 'YAHOO_FINANCE_UPDATED',
} as const;

export interface YahooFinanceArticle {
  ticker: string;
  source: string;
  articles: unknown[];
}
