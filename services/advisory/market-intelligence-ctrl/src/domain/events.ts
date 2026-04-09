import { eventName } from '@nestfolio/event-types';

export const MarketIntelligenceEventTypes = {
  MARKET_ANALYSIS_COMPLETED: eventName('MARKET_ANALYSIS_COMPLETED'),
  MARKET_SIGNAL_DETECTED: eventName('MARKET_SIGNAL_DETECTED'),
} as const;

export const HANDLED_EVENT_TYPES = new Set([eventName('ANALYZE_MARKET')]);

export const FEED_INGESTION_EVENT_TYPES = new Set([
  eventName('YAHOO_FINANCE_UPDATED'),
  eventName('MARKETWATCH_UPDATED'),
  eventName('SEC_8K_FILED'),
  eventName('FRED_INDICATORS_UPDATED'),
  eventName('ALPHA_VANTAGE_NEWS_UPDATED'),
]);
