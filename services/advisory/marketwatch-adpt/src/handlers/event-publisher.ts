import {
  EventBridgeBus,
  envVar,
  logger,
  publishOrUpload,
  parseRssFeed,
} from '@nestfolio/event-processor';
import { MarketwatchAdptEventTypes } from '../domain/events';

const FETCH_TIMEOUT_MS = 10_000;

const FEEDS = [
  { name: 'topstories', url: 'https://feeds.marketwatch.com/marketwatch/topstories' },
  { name: 'marketpulse', url: 'https://feeds.marketwatch.com/marketwatch/marketpulse' },
] as const;

export function createHandler() {
  const busName = envVar('BUS_NAME');
  const serviceName = envVar('SERVICE_NAME');
  const bucket = envVar('KB_BUCKET');

  const bus = new EventBridgeBus(busName, serviceName);

  return async (): Promise<void> => {
    logger.info('Starting MarketWatch RSS fetch');

    for (const feed of FEEDS) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        const response = await fetch(feed.url, { signal: controller.signal });
        clearTimeout(timeout);

        if (!response.ok) {
          logger.warn('RSS fetch failed', { feed: feed.name, status: response.status });
          continue;
        }

        const xml = await response.text();
        const articles = parseRssFeed(xml);

        await publishOrUpload({
          bus,
          bucket,
          eventType: MarketwatchAdptEventTypes.MARKETWATCH_UPDATED,
          content: { source: 'marketwatch', feed: feed.name, articles },
          serviceName,
        });

        logger.info('Published MarketWatch update', { feed: feed.name, articleCount: articles.length });
      } catch (error) {
        logger.error('Failed to process feed', { feed: feed.name, error });
      }
    }
  };
}

export const handler = createHandler();
