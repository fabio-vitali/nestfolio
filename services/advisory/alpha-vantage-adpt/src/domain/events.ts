export const AlphaVantageAdptEventTypes = {
  FETCH_REQUESTED: 'FETCH_ALPHA_VANTAGE_REQUESTED',
  ALPHA_VANTAGE_NEWS_UPDATED: 'ALPHA_VANTAGE_NEWS_UPDATED',
  ECONOMIC_INDICATOR_UPDATED: 'ALPHA_VANTAGE_ECONOMIC_INDICATOR_UPDATED',
} as const;

export const AlphaVantageEntityTypes = ['AlphaVantageArticle', 'EconomicIndicator'] as const;
