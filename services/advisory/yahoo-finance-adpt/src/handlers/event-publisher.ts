import {
  EventBridgeBus,
  envVar,
  logger,
  publishOrUpload,
  parseRssFeed,
} from '@nestfolio/event-processor';
import { YahooFinanceAdptEventTypes } from '../domain/events';

const FETCH_TIMEOUT_MS = 10_000;
const BASE_URL = 'https://feeds.finance.yahoo.com/rss/2.0/headline';

export function createHandler() {
  const busName = envVar('BUS_NAME');
  const serviceName = envVar('SERVICE_NAME');
  const bucket = envVar('KB_BUCKET');
  const tickers = envVar('TICKERS').split(',').map((t) => t.trim());

  const bus = new EventBridgeBus(busName, serviceName);

  return async (): Promise<void> => {
    logger.info('Starting Yahoo Finance RSS fetch', { tickers });

    for (const ticker of tickers) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        const response = await fetch(`${BASE_URL}?s=${ticker}`, {
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!response.ok) {
          logger.warn('RSS fetch failed', { ticker, status: response.status });
          continue;
        }

        const xml = await response.text();
        const articles = parseRssFeed(xml);

        await publishOrUpload({
          bus,
          bucket,
          eventType: YahooFinanceAdptEventTypes.YAHOO_FINANCE_UPDATED,
          content: { source: 'yahoo-finance', ticker, articles },
          serviceName,
        });

        logger.info('Published Yahoo Finance update', { ticker, articleCount: articles.length });
      } catch (error) {
        logger.error('Failed to process ticker', { ticker, error });
      }
    }
  };
}

export const handler = createHandler();
