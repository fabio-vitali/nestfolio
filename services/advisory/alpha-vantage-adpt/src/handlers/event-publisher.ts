import {
  EventBridgeBus,
  envVar,
  logger,
  publishOrUpload,
} from '@nestfolio/event-processor';
import { AlphaVantageAdptEventTypes } from '../service-domain/events';

const AV_BASE_URL = 'https://www.alphavantage.co/query';
const FETCH_TIMEOUT_MS = 15_000;
const MAX_REQUESTS_PER_CYCLE = 25;

const NEWS_TICKERS = ['VTI', 'BND', 'QQQ', 'SPY'];
const ECONOMIC_FUNCTIONS = ['REAL_GDP', 'CPI', 'TREASURY_YIELD', 'FEDERAL_FUNDS_RATE', 'UNEMPLOYMENT'];

export function createHandler() {
  const busName = envVar('BUS_NAME');
  const serviceName = envVar('SERVICE_NAME');
  const bucket = envVar('KB_BUCKET');
  const apiKey = envVar('ALPHA_VANTAGE_API_KEY');

  const bus = new EventBridgeBus(busName, serviceName);

  async function fetchAV(params: Record<string, string>): Promise<unknown | null> {
    const url = new URL(AV_BASE_URL);
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

  return async (): Promise<void> => {
    logger.info('Starting Alpha Vantage data fetch');

    let requestCount = 0;
    const newsData: unknown[] = [];
    const economicData: unknown[] = [];

    // Phase 1: News sentiment for each ticker
    for (const ticker of NEWS_TICKERS) {
      if (requestCount >= MAX_REQUESTS_PER_CYCLE - ECONOMIC_FUNCTIONS.length) break;

      const data = await fetchAV({ function: 'NEWS_SENTIMENT', tickers: ticker });
      requestCount++;

      if (data && (data as any).feed) {
        newsData.push(...(data as any).feed);
      }
    }

    // Phase 2: Economic indicators
    for (const fn of ECONOMIC_FUNCTIONS) {
      if (requestCount >= MAX_REQUESTS_PER_CYCLE) break;

      const data = await fetchAV({ function: fn });
      requestCount++;

      if (data) {
        economicData.push({ function: fn, data });
      }
    }

    logger.info('Alpha Vantage fetch complete', { requestCount, newsItems: newsData.length, econItems: economicData.length });

    // Publish news data
    if (newsData.length > 0) {
      await publishOrUpload({
        bus,
        bucket,
        eventType: AlphaVantageAdptEventTypes.ALPHA_VANTAGE_NEWS_UPDATED,
        content: { source: 'alpha-vantage', type: 'news', data: newsData },
        serviceName,
      });
    }

    // Publish economic data
    if (economicData.length > 0) {
      await publishOrUpload({
        bus,
        bucket,
        eventType: AlphaVantageAdptEventTypes.ALPHA_VANTAGE_NEWS_UPDATED,
        content: { source: 'alpha-vantage', type: 'economic', data: economicData },
        serviceName,
      });
    }
  };
}

export const handler = createHandler();
