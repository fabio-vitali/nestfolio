import { materializeToTable, record, requireEnv, logger, parseRssFeed, type WriteIntent, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { YahooFinanceAdptEventTypes } from '../domain/events';

const FETCH_TIMEOUT_MS = 10_000;
const BASE_URL = 'https://feeds.finance.yahoo.com/rss/2.0/headline';

export interface EventListenerDeps {
  fetchFeed: (url: string) => Promise<string | null>;
  parseRss: (xml: string) => unknown[];
  getTickers: () => string[];
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
    getTickers: () => requireEnv('TICKERS').split(',').map((t) => t.trim()),
  };
}

async function handleFetchRequested(
  deps: EventListenerDeps,
  _payload: EventPayload,
  _ctx: EventContext,
): Promise<WriteIntent[]> {
  const tickers = deps.getTickers();
  logger.info('Starting Yahoo Finance RSS fetch', { tickerCount: tickers.length });

  const intents: WriteIntent[] = [];

  for (const ticker of tickers) {
    const url = `${BASE_URL}?s=${ticker}`;
    const xml = await deps.fetchFeed(url);

    if (xml) {
      const articles = deps.parseRss(xml);

      intents.push(
        record('YahooFinanceArticle', { source: 'yahoo-finance', ticker, articles }, {
          pk: 'YahooFinance#SYSTEM',
          sk: `Ticker#${ticker}`,
        }),
      );

      logger.info('Fetched Yahoo Finance feed', { ticker, articleCount: articles.length });
    }
  }

  logger.info('Yahoo Finance fetch complete', { fetched: intents.length, total: tickers.length });
  return intents;
}

export function createHandlers(deps: EventListenerDeps) {
  return {
    [YahooFinanceAdptEventTypes.FETCH_REQUESTED]: (payload: EventPayload, ctx: EventContext) =>
      handleFetchRequested(deps, payload, ctx),
  };
}

// Production wiring
const deps = createDeps();

export const handler = materializeToTable({
  serviceName: 'yahoo-finance-adpt',
  handlers: createHandlers(deps),
  errorEventType: 'YAHOO_FINANCE_ADPT_FAILED',
});
