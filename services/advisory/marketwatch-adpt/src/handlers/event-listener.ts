import { materializeToTable, record, requireEnv, logger, parseRssFeed, type WriteIntent, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { MarketwatchAdptEventTypes } from '../domain/events';

const FETCH_TIMEOUT_MS = 10_000;

export const FEEDS = [
  { name: 'topstories', url: 'https://feeds.marketwatch.com/marketwatch/topstories' },
  { name: 'marketpulse', url: 'https://feeds.marketwatch.com/marketwatch/marketpulse' },
] as const;

export interface EventListenerDeps {
  fetchFeed: (url: string) => Promise<string | null>;
  parseRss: (xml: string) => unknown[];
}

export function createDeps(): EventListenerDeps {
  return {
    fetchFeed: async (url: string) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);

        if (!response.ok) {
          logger.warn('RSS fetch failed', { url, status: response.status });
          return null;
        }

        return await response.text();
      } catch (error) {
        clearTimeout(timeout);
        logger.error('Failed to fetch RSS feed', { url, error });
        return null;
      }
    },
    parseRss: parseRssFeed,
  };
}

async function handleFetchRequested(
  deps: EventListenerDeps,
  _payload: EventPayload,
  _ctx: EventContext,
): Promise<WriteIntent[]> {
  logger.info('Starting MarketWatch RSS fetch', { feedCount: FEEDS.length });

  const intents: WriteIntent[] = [];

  for (const feed of FEEDS) {
    const xml = await deps.fetchFeed(feed.url);

    if (xml) {
      const articles = deps.parseRss(xml);

      intents.push(
        record('MarketWatchArticle', { source: 'marketwatch', feed: feed.name, articles }, {
          pk: 'MarketWatch#SYSTEM',
          sk: `Feed#${feed.name}`,
        }),
      );

      logger.info('Fetched MarketWatch feed', { feed: feed.name, articleCount: articles.length });
    }
  }

  logger.info('MarketWatch fetch complete', { fetched: intents.length, total: FEEDS.length });
  return intents;
}

export function createHandlers(deps: EventListenerDeps) {
  return {
    [MarketwatchAdptEventTypes.FETCH_REQUESTED]: (payload: EventPayload, ctx: EventContext) =>
      handleFetchRequested(deps, payload, ctx),
  };
}

// Production wiring
const deps = createDeps();

export const handler = materializeToTable({
  serviceName: 'marketwatch-adpt',
  handlers: createHandlers(deps),
  errorEventType: 'MARKETWATCH_ADPT_FAILED',
});
