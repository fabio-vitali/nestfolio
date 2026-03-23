export const MarketwatchAdptEventTypes = {
  FETCH_REQUESTED: 'FETCH_MARKETWATCH_REQUESTED',
  MARKETWATCH_UPDATED: 'MARKETWATCH_UPDATED',
} as const;

export const MarketwatchEntityTypes = ['MarketWatchArticle'] as const;

export interface MarketWatchArticle {
  feed: string;
  source: string;
  articles: unknown[];
}
