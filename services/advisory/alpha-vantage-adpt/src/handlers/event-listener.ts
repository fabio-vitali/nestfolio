import { materializeToTable, project, requireEnv, logger, type WriteIntent, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { AlphaVantageAdptEventTypes } from '../domain/events';
import type { EconomicIndicator } from '../domain/contracts';

const FETCH_TIMEOUT_MS = 15_000;
const MAX_REQUESTS_PER_CYCLE = 25;

const NEWS_TICKERS = ['VTI', 'BND', 'QQQ', 'SPY'];
const ECONOMIC_FUNCTIONS = ['REAL_GDP', 'CPI', 'TREASURY_YIELD', 'FEDERAL_FUNDS_RATE', 'UNEMPLOYMENT'];

export interface EventListenerDeps {
  getBaseUrl: () => Promise<string>;
  fetchNews: (ticker: string) => Promise<unknown[] | null>;
  fetchIndicator: (fn: string) => Promise<unknown | null>;
}

async function resolveBaseUrl(): Promise<string> {
  const port = process.env.PARAMETERS_SECRETS_EXTENSION_HTTP_PORT ?? '2773';
  const token = process.env.AWS_SESSION_TOKEN!;
  const paramName = process.env.ALPHA_VANTAGE_BASE_URL_PARAM!;

  const res = await fetch(
    `http://localhost:${port}/systemsmanager/parameters/get?name=${encodeURIComponent(paramName)}`,
    { headers: { 'X-Aws-Parameters-Secrets-Token': token } },
  );
  const data = await res.json() as { Parameter: { Value: string } };
  return data.Parameter.Value;
}

async function fetchAV(baseUrl: string, apiKey: string, params: Record<string, string>): Promise<unknown | null> {
  const url = new URL(baseUrl);
  url.searchParams.set('apikey', apiKey);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return null;
    return response.json();
  } catch (error) {
    clearTimeout(timeout);
    logger.error('Alpha Vantage fetch failed', { params, error });
    return null;
  }
}

export function createDeps(apiKey: string): EventListenerDeps {
  let cachedBaseUrl: string | undefined;

  const getBaseUrl = async (): Promise<string> => {
    if (!cachedBaseUrl) {
      cachedBaseUrl = await resolveBaseUrl();
    }
    return cachedBaseUrl;
  };

  return {
    getBaseUrl,
    fetchNews: async (ticker: string) => {
      const baseUrl = await getBaseUrl();
      const data = await fetchAV(baseUrl, apiKey, { function: 'NEWS_SENTIMENT', tickers: ticker });
      if (data && (data as any).feed) {
        return (data as any).feed as unknown[];
      }
      return null;
    },
    fetchIndicator: async (fn: string) => {
      const baseUrl = await getBaseUrl();
      const data = await fetchAV(baseUrl, apiKey, { function: fn });
      return data ?? null;
    },
  };
}

async function handleFetchRequested(
  deps: EventListenerDeps,
  _payload: EventPayload,
  _ctx: EventContext,
): Promise<WriteIntent[]> {
  logger.info('Starting Alpha Vantage data fetch');

  let requestCount = 0;
  const intents: WriteIntent[] = [];

  // Phase 1: News sentiment for each ticker
  for (const ticker of NEWS_TICKERS) {
    if (requestCount >= MAX_REQUESTS_PER_CYCLE - ECONOMIC_FUNCTIONS.length) break;

    const articles = await deps.fetchNews(ticker);
    requestCount++;

    if (articles) {
      for (let i = 0; i < articles.length; i++) {
        const article = articles[i] as Record<string, unknown>;
        const dateStr = (article['time_published'] as string | undefined) ?? new Date().toISOString().slice(0, 10).replace(/-/g, '');
        intents.push(
          project('AlphaVantageArticle', article, {
            pk: 'AlphaVantage#SYSTEM',
            sk: `Article#${ticker}#${dateStr}#${i}`,
          }),
        );
      }
    }
  }

  // Phase 2: Economic indicators
  for (const fn of ECONOMIC_FUNCTIONS) {
    if (requestCount >= MAX_REQUESTS_PER_CYCLE) break;

    const data = await deps.fetchIndicator(fn);
    requestCount++;

    if (data) {
      const indicator: EconomicIndicator = { function: fn, data };
      intents.push(
        project('EconomicIndicator', indicator, {
          pk: 'AlphaVantage#SYSTEM',
          sk: `Indicator#${fn}`,
        }),
      );
    }
  }

  logger.info('Alpha Vantage fetch complete', { requestCount, intents: intents.length });
  return intents;
}

export function createHandlers(deps: EventListenerDeps) {
  return {
    [AlphaVantageAdptEventTypes.FETCH_REQUESTED]: (payload: EventPayload, ctx: EventContext) =>
      handleFetchRequested(deps, payload, ctx),
  };
}

// Production wiring
const apiKey = requireEnv('ALPHA_VANTAGE_API_KEY');
const deps = createDeps(apiKey);

export const handler = materializeToTable({
  serviceName: 'alpha-vantage-adpt',
  handlers: createHandlers(deps),
  errorEventType: 'ALPHA_VANTAGE_ADPT_FAILED',
});
