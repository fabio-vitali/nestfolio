import { materializeToTable, record, logger, parseRssFeed, type WriteIntent, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { MarketwatchAdptEventTypes } from '../domain/events';

const FETCH_TIMEOUT_MS = 10_000;

export const FEED_PATHS = ['topstories', 'marketpulse'] as const;

export interface EventListenerDeps {
  getBaseUrl: () => Promise<string>;
  fetchFeed: (url: string) => Promise<string | null>;
  parseRss: (xml: string) => unknown[];
}

async function resolveBaseUrl(): Promise<string> {
  const port = process.env.PARAMETERS_SECRETS_EXTENSION_HTTP_PORT ?? '2773';
  const token = process.env.AWS_SESSION_TOKEN!;
  const paramName = process.env.MARKETWATCH_BASE_URL_PARAM!;

  const res = await fetch(
    `http://localhost:${port}/systemsmanager/parameters/get?name=${encodeURIComponent(paramName)}`,
    { headers: { 'X-Aws-Parameters-Secrets-Token': token } },
  );
  const data = await res.json() as { Parameter: { Value: string } };
  return data.Parameter.Value;
}

export function createDeps(): EventListenerDeps {
  let cachedBaseUrl: string | undefined;

  return {
    getBaseUrl: async () => {
      if (!cachedBaseUrl) {
        cachedBaseUrl = await resolveBaseUrl();
      }
      return cachedBaseUrl;
    },
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
  const baseUrl = await deps.getBaseUrl();
  logger.info('Starting MarketWatch RSS fetch', { feedCount: FEED_PATHS.length, baseUrl });

  const intents: WriteIntent[] = [];

  for (const feedPath of FEED_PATHS) {
    const url = `${baseUrl}/${feedPath}`;
    const xml = await deps.fetchFeed(url);

    if (xml) {
      const articles = deps.parseRss(xml);

      intents.push(
        record('MarketWatchArticle', { source: 'marketwatch', feed: feedPath, articles }, {
          pk: 'MarketWatch#SYSTEM',
          sk: `Feed#${feedPath}`,
        }),
      );

      logger.info('Fetched MarketWatch feed', { feed: feedPath, articleCount: articles.length });
    }
  }

  logger.info('MarketWatch fetch complete', { fetched: intents.length, total: FEED_PATHS.length });
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
