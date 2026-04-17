import { fakeSqsRecord } from '@nestfolio/event-processor';

jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
  requireEnv: jest.fn().mockImplementation((name: string) => {
    const vars: Record<string, string> = {
      ALPHA_VANTAGE_API_KEY: 'test-av-key',
      TABLE_NAME: 'test-table',
      BUS_NAME: 'test-bus',
      SERVICE_NAME: 'alpha-vantage-adpt',
    };
    return vars[name] ?? '';
  }),
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

import { createDeps, createHandlers } from '../../../src/handlers/event-listener';
import { AlphaVantageAdptEventTypes } from '../../../src/domain/events';

const SAMPLE_ARTICLES = [
  {
    title: 'VTI gains 2%',
    url: 'https://example.com/vti',
    time_published: '20260317T100000',
    summary: 'Total market ETF surges',
    overall_sentiment_score: 0.85,
  },
  {
    title: 'VTI outlook',
    url: 'https://example.com/vti2',
    time_published: '20260317T110000',
    summary: 'Analysts bullish on VTI',
    overall_sentiment_score: 0.72,
  },
];

const SAMPLE_INDICATOR = {
  name: 'Real Gross Domestic Product',
  interval: 'annual',
  unit: 'billions of dollars',
  data: [{ date: '2025-01-01', value: '29000' }],
};

describe('alpha-vantage-adpt event-listener', () => {
  let mockFetchNews: jest.Mock;
  let mockFetchIndicator: jest.Mock;
  let handlers: ReturnType<typeof createHandlers>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchNews = jest.fn().mockResolvedValue(SAMPLE_ARTICLES);
    mockFetchIndicator = jest.fn().mockResolvedValue(SAMPLE_INDICATOR);
    const deps = {
      getBaseUrl: jest.fn().mockResolvedValue('https://www.alphavantage.co/query'),
      fetchNews: mockFetchNews,
      fetchIndicator: mockFetchIndicator,
    };
    handlers = createHandlers(deps);
  });

  describe('FETCH_ALPHA_VANTAGE_REQUESTED handler', () => {
    it('calls fetchNews for each configured ticker', async () => {
      const record = fakeSqsRecord(AlphaVantageAdptEventTypes.FETCH_REQUESTED, {});
      const payload = JSON.parse(record.body).detail;
      const ctx = { tenantId: 'SYSTEM', eventId: payload.id, eventType: payload.type, timestamp: payload.timestamp };

      await handlers[AlphaVantageAdptEventTypes.FETCH_REQUESTED](payload.subject, ctx as any);

      // 4 tickers: VTI, BND, QQQ, SPY (limited by MAX_REQUESTS_PER_CYCLE - ECONOMIC_FUNCTIONS.length = 20)
      expect(mockFetchNews).toHaveBeenCalledWith('VTI');
      expect(mockFetchNews).toHaveBeenCalledWith('BND');
      expect(mockFetchNews).toHaveBeenCalledWith('QQQ');
      expect(mockFetchNews).toHaveBeenCalledWith('SPY');
    });

    it('calls fetchIndicator for each economic function', async () => {
      const record = fakeSqsRecord(AlphaVantageAdptEventTypes.FETCH_REQUESTED, {});
      const payload = JSON.parse(record.body).detail;
      const ctx = { tenantId: 'SYSTEM', eventId: payload.id, eventType: payload.type, timestamp: payload.timestamp };

      await handlers[AlphaVantageAdptEventTypes.FETCH_REQUESTED](payload.subject, ctx as any);

      expect(mockFetchIndicator).toHaveBeenCalledWith('REAL_GDP');
      expect(mockFetchIndicator).toHaveBeenCalledWith('CPI');
      expect(mockFetchIndicator).toHaveBeenCalledWith('TREASURY_YIELD');
      expect(mockFetchIndicator).toHaveBeenCalledWith('FEDERAL_FUNDS_RATE');
      expect(mockFetchIndicator).toHaveBeenCalledWith('UNEMPLOYMENT');
    });

    it('returns AlphaVantageArticle record intents for each article', async () => {
      const record = fakeSqsRecord(AlphaVantageAdptEventTypes.FETCH_REQUESTED, {});
      const payload = JSON.parse(record.body).detail;
      const ctx = { tenantId: 'SYSTEM', eventId: payload.id, eventType: payload.type, timestamp: payload.timestamp };

      const intents = await handlers[AlphaVantageAdptEventTypes.FETCH_REQUESTED](payload.subject, ctx as any);

      const articleIntents = intents.filter((i: any) => i.typename === 'AlphaVantageArticle');
      // 4 tickers × 2 articles each = 8 article intents
      expect(articleIntents.length).toBe(8);
      for (const intent of articleIntents) {
        expect((intent as any)._tag).toBe('project');
        expect((intent as any).overrides.pk).toBe('AlphaVantage#SYSTEM');
        expect((intent as any).overrides.sk).toMatch(/^Article#/);
      }
    });

    it('returns EconomicIndicator record intents for each indicator', async () => {
      const record = fakeSqsRecord(AlphaVantageAdptEventTypes.FETCH_REQUESTED, {});
      const payload = JSON.parse(record.body).detail;
      const ctx = { tenantId: 'SYSTEM', eventId: payload.id, eventType: payload.type, timestamp: payload.timestamp };

      const intents = await handlers[AlphaVantageAdptEventTypes.FETCH_REQUESTED](payload.subject, ctx as any);

      const indicatorIntents = intents.filter((i: any) => i.typename === 'EconomicIndicator');
      expect(indicatorIntents.length).toBe(5); // REAL_GDP, CPI, TREASURY_YIELD, FEDERAL_FUNDS_RATE, UNEMPLOYMENT
      for (const intent of indicatorIntents) {
        expect((intent as any)._tag).toBe('project');
        expect((intent as any).overrides.pk).toBe('AlphaVantage#SYSTEM');
        expect((intent as any).overrides.sk).toMatch(/^Indicator#/);
      }
    });

    it('sk for EconomicIndicator includes the function name for deduplication', async () => {
      const record = fakeSqsRecord(AlphaVantageAdptEventTypes.FETCH_REQUESTED, {});
      const payload = JSON.parse(record.body).detail;
      const ctx = { tenantId: 'SYSTEM', eventId: payload.id, eventType: payload.type, timestamp: payload.timestamp };

      const intents = await handlers[AlphaVantageAdptEventTypes.FETCH_REQUESTED](payload.subject, ctx as any);

      const gdpIntent = intents.find(
        (i: any) => i.typename === 'EconomicIndicator' && i.overrides.sk === 'Indicator#REAL_GDP',
      );
      expect(gdpIntent).toBeDefined();
    });

    it('skips articles when fetchNews returns null', async () => {
      mockFetchNews.mockResolvedValue(null);
      const record = fakeSqsRecord(AlphaVantageAdptEventTypes.FETCH_REQUESTED, {});
      const payload = JSON.parse(record.body).detail;
      const ctx = { tenantId: 'SYSTEM', eventId: payload.id, eventType: payload.type, timestamp: payload.timestamp };

      const intents = await handlers[AlphaVantageAdptEventTypes.FETCH_REQUESTED](payload.subject, ctx as any);

      const articleIntents = intents.filter((i: any) => i.typename === 'AlphaVantageArticle');
      expect(articleIntents.length).toBe(0);
    });

    it('skips indicators when fetchIndicator returns null', async () => {
      mockFetchIndicator.mockResolvedValue(null);
      const record = fakeSqsRecord(AlphaVantageAdptEventTypes.FETCH_REQUESTED, {});
      const payload = JSON.parse(record.body).detail;
      const ctx = { tenantId: 'SYSTEM', eventId: payload.id, eventType: payload.type, timestamp: payload.timestamp };

      const intents = await handlers[AlphaVantageAdptEventTypes.FETCH_REQUESTED](payload.subject, ctx as any);

      const indicatorIntents = intents.filter((i: any) => i.typename === 'EconomicIndicator');
      expect(indicatorIntents.length).toBe(0);
    });
  });

  describe('createDeps', () => {
    const mockFetch = jest.fn();
    const originalFetch = global.fetch;
    const originalEnv = { ...process.env };

    beforeEach(() => {
      global.fetch = mockFetch as any;
      process.env.PARAMETERS_SECRETS_EXTENSION_HTTP_PORT = '2773';
      process.env.AWS_SESSION_TOKEN = 'test-session-token';
      process.env.ALPHA_VANTAGE_BASE_URL_PARAM = '/nestfolio/dev-alpha-vantage-adpt/alpha-vantage/baseUrl';
    });

    afterEach(() => {
      global.fetch = originalFetch;
      process.env = { ...originalEnv };
    });

    /** Helper: mock SSM extension response first, then the actual API response */
    function mockSsmThenApi(apiResponse: { ok: boolean; json?: () => Promise<unknown> }) {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ Parameter: { Value: 'https://www.alphavantage.co/query' } }),
        })
        .mockResolvedValueOnce(apiResponse);
    }

    it('fetchNews extracts feed array from response', async () => {
      mockSsmThenApi({
        ok: true,
        json: () => Promise.resolve({ feed: SAMPLE_ARTICLES }),
      });

      const deps = createDeps('test-key');
      const result = await deps.fetchNews('VTI');

      expect(result).toEqual(SAMPLE_ARTICLES);
      // First call is SSM extension, second is the actual API call
      const apiCall = mockFetch.mock.calls[1][0] as string;
      expect(apiCall).toContain('NEWS_SENTIMENT');
      expect(apiCall).toContain('VTI');
      expect(apiCall).toContain('test-key');
    });

    it('fetchNews returns null when response has no feed', async () => {
      mockSsmThenApi({
        ok: true,
        json: () => Promise.resolve({ message: 'no data' }),
      });

      const deps = createDeps('test-key');
      const result = await deps.fetchNews('VTI');

      expect(result).toBeNull();
    });

    it('fetchIndicator returns raw response data', async () => {
      mockSsmThenApi({
        ok: true,
        json: () => Promise.resolve(SAMPLE_INDICATOR),
      });

      const deps = createDeps('test-key');
      const result = await deps.fetchIndicator('REAL_GDP');

      expect(result).toEqual(SAMPLE_INDICATOR);
      const apiCall = mockFetch.mock.calls[1][0] as string;
      expect(apiCall).toContain('REAL_GDP');
    });

    it('fetchNews returns null on HTTP error', async () => {
      mockSsmThenApi({ ok: false });

      const deps = createDeps('test-key');
      const result = await deps.fetchNews('VTI');

      expect(result).toBeNull();
    });

    it('fetchIndicator returns null on fetch error', async () => {
      // SSM resolves, but API call rejects
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ Parameter: { Value: 'https://www.alphavantage.co/query' } }),
        })
        .mockRejectedValueOnce(new Error('Network error'));

      const deps = createDeps('test-key');
      const result = await deps.fetchIndicator('CPI');

      expect(result).toBeNull();
    });

    it('getBaseUrl caches the resolved URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ Parameter: { Value: 'https://mock.example.com' } }),
      });

      const deps = createDeps('test-key');
      const url1 = await deps.getBaseUrl();
      const url2 = await deps.getBaseUrl();

      expect(url1).toBe('https://mock.example.com');
      expect(url2).toBe('https://mock.example.com');
      // SSM extension should only be called once (cached)
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
