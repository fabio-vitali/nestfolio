import { fakeSqsRecord } from '@nestfolio/event-processor';

jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
  requireEnv: jest.fn().mockImplementation((name: string) => {
    const vars: Record<string, string> = {
      TABLE_NAME: 'test-table',
      BUS_NAME: 'test-bus',
      SERVICE_NAME: 'yahoo-finance-adpt',
      TICKERS: 'VTI,BND,QQQ',
    };
    return vars[name] ?? '';
  }),
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

import { createDeps, createHandlers } from '../../src/handlers/event-listener';
import { YahooFinanceAdptEventTypes } from '../../src/domain/events';

const SAMPLE_XML = '<rss><channel><item><title>Test</title></item></channel></rss>';
const SAMPLE_ARTICLES = [{ title: 'Test Article' }];
const TEST_TICKERS = ['VTI', 'BND', 'QQQ'];

const TEST_BASE_URL = 'https://feeds.finance.yahoo.com/rss/2.0/headline';

describe('yahoo-finance-adpt event-listener', () => {
  let mockGetBaseUrl: jest.Mock;
  let mockFetchFeed: jest.Mock;
  let mockParseRss: jest.Mock;
  let mockGetTickers: jest.Mock;
  let handlers: ReturnType<typeof createHandlers>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetBaseUrl = jest.fn().mockResolvedValue(TEST_BASE_URL);
    mockFetchFeed = jest.fn().mockResolvedValue(SAMPLE_XML);
    mockParseRss = jest.fn().mockReturnValue(SAMPLE_ARTICLES);
    mockGetTickers = jest.fn().mockReturnValue(TEST_TICKERS);
    const deps = { getBaseUrl: mockGetBaseUrl, fetchFeed: mockFetchFeed, parseRss: mockParseRss, getTickers: mockGetTickers };
    handlers = createHandlers(deps);
  });

  describe('FETCH_YAHOO_FINANCE_REQUESTED handler', () => {
    it('calls fetchFeed for each configured ticker', async () => {
      const sqsRecord = fakeSqsRecord(YahooFinanceAdptEventTypes.FETCH_REQUESTED, {});
      const payload = JSON.parse(sqsRecord.body).detail;
      const ctx = { tenantId: 'SYSTEM', eventId: payload.id };

      await handlers[YahooFinanceAdptEventTypes.FETCH_REQUESTED](payload, ctx);

      expect(mockFetchFeed).toHaveBeenCalledTimes(TEST_TICKERS.length);
    });

    it('resolves base URL via getBaseUrl and constructs feed URLs', async () => {
      const sqsRecord = fakeSqsRecord(YahooFinanceAdptEventTypes.FETCH_REQUESTED, {});
      const payload = JSON.parse(sqsRecord.body).detail;
      const ctx = { tenantId: 'SYSTEM', eventId: payload.id };

      await handlers[YahooFinanceAdptEventTypes.FETCH_REQUESTED](payload, ctx);

      expect(mockGetBaseUrl).toHaveBeenCalledTimes(1);
      for (const ticker of TEST_TICKERS) {
        expect(mockFetchFeed).toHaveBeenCalledWith(
          `${TEST_BASE_URL}?s=${ticker}`,
        );
      }
    });

    it('returns a WriteIntent for each successful ticker fetch', async () => {
      const sqsRecord = fakeSqsRecord(YahooFinanceAdptEventTypes.FETCH_REQUESTED, {});
      const payload = JSON.parse(sqsRecord.body).detail;
      const ctx = { tenantId: 'SYSTEM', eventId: payload.id };

      const intents = await handlers[YahooFinanceAdptEventTypes.FETCH_REQUESTED](payload, ctx);

      expect(intents).toHaveLength(TEST_TICKERS.length);
    });

    it('skips tickers where fetchFeed returns null', async () => {
      mockFetchFeed
        .mockResolvedValueOnce(null)
        .mockResolvedValue(SAMPLE_XML);

      const sqsRecord = fakeSqsRecord(YahooFinanceAdptEventTypes.FETCH_REQUESTED, {});
      const payload = JSON.parse(sqsRecord.body).detail;
      const ctx = { tenantId: 'SYSTEM', eventId: payload.id };

      const intents = await handlers[YahooFinanceAdptEventTypes.FETCH_REQUESTED](payload, ctx);

      expect(intents).toHaveLength(TEST_TICKERS.length - 1);
    });

    it('returns empty array when all tickers return null', async () => {
      mockFetchFeed.mockResolvedValue(null);

      const sqsRecord = fakeSqsRecord(YahooFinanceAdptEventTypes.FETCH_REQUESTED, {});
      const payload = JSON.parse(sqsRecord.body).detail;
      const ctx = { tenantId: 'SYSTEM', eventId: payload.id };

      const intents = await handlers[YahooFinanceAdptEventTypes.FETCH_REQUESTED](payload, ctx);

      expect(intents).toHaveLength(0);
    });

    it('WriteIntents have entity type YahooFinanceArticle with correct pk/sk', async () => {
      mockFetchFeed.mockResolvedValueOnce(SAMPLE_XML).mockResolvedValue(null);

      const sqsRecord = fakeSqsRecord(YahooFinanceAdptEventTypes.FETCH_REQUESTED, {});
      const payload = JSON.parse(sqsRecord.body).detail;
      const ctx = { tenantId: 'SYSTEM', eventId: payload.id };

      const intents = await handlers[YahooFinanceAdptEventTypes.FETCH_REQUESTED](payload, ctx);

      expect(intents).toHaveLength(1);
      const intent = intents[0] as any;
      expect(intent.typename).toBe('YahooFinanceArticle');
      expect(intent.overrides.pk).toBe('YahooFinance#SYSTEM');
      expect(intent.overrides.sk).toBe(`Ticker#${TEST_TICKERS[0]}`);
    });

    it('calls parseRss with the fetched XML for each successful ticker', async () => {
      const sqsRecord = fakeSqsRecord(YahooFinanceAdptEventTypes.FETCH_REQUESTED, {});
      const payload = JSON.parse(sqsRecord.body).detail;
      const ctx = { tenantId: 'SYSTEM', eventId: payload.id };

      await handlers[YahooFinanceAdptEventTypes.FETCH_REQUESTED](payload, ctx);

      expect(mockParseRss).toHaveBeenCalledTimes(TEST_TICKERS.length);
      expect(mockParseRss).toHaveBeenCalledWith(SAMPLE_XML);
    });
  });

  describe('createDeps', () => {
    it('returns an object with getBaseUrl, fetchFeed, parseRss, and getTickers functions', () => {
      const deps = createDeps();
      expect(typeof deps.getBaseUrl).toBe('function');
      expect(typeof deps.fetchFeed).toBe('function');
      expect(typeof deps.parseRss).toBe('function');
      expect(typeof deps.getTickers).toBe('function');
    });
  });
});
