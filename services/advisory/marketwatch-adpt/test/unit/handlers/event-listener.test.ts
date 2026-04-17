import { fakeSqsRecord } from '@nestfolio/event-processor';

jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
  requireEnv: jest.fn().mockImplementation((name: string) => {
    const vars: Record<string, string> = {
      TABLE_NAME: 'test-table',
      BUS_NAME: 'test-bus',
      SERVICE_NAME: 'marketwatch-adpt',
    };
    return vars[name] ?? '';
  }),
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

import { createDeps, createHandlers, FEED_PATHS } from '../../../src/handlers/event-listener';
import { MarketwatchAdptEventTypes } from '../../../src/domain/events';

const SAMPLE_XML = '<rss><channel><item><title>Test</title></item></channel></rss>';
const SAMPLE_ARTICLES = [{ title: 'Test Article' }];

const TEST_BASE_URL = 'https://feeds.marketwatch.com/marketwatch';

describe('marketwatch-adpt event-listener', () => {
  let mockGetBaseUrl: jest.Mock;
  let mockFetchFeed: jest.Mock;
  let mockParseRss: jest.Mock;
  let handlers: ReturnType<typeof createHandlers>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetBaseUrl = jest.fn().mockResolvedValue(TEST_BASE_URL);
    mockFetchFeed = jest.fn().mockResolvedValue(SAMPLE_XML);
    mockParseRss = jest.fn().mockReturnValue(SAMPLE_ARTICLES);
    const deps = { getBaseUrl: mockGetBaseUrl, fetchFeed: mockFetchFeed, parseRss: mockParseRss };
    handlers = createHandlers(deps);
  });

  describe('FETCH_MARKETWATCH_REQUESTED handler', () => {
    it('calls fetchFeed for each configured feed', async () => {
      const sqsRecord = fakeSqsRecord(MarketwatchAdptEventTypes.FETCH_REQUESTED, {});
      const payload = JSON.parse(sqsRecord.body).detail;
      const ctx = { tenantId: 'SYSTEM', eventId: payload.id };

      await handlers[MarketwatchAdptEventTypes.FETCH_REQUESTED](payload, ctx);

      expect(mockFetchFeed).toHaveBeenCalledTimes(FEED_PATHS.length);
    });

    it('resolves base URL via getBaseUrl and constructs feed URLs', async () => {
      const sqsRecord = fakeSqsRecord(MarketwatchAdptEventTypes.FETCH_REQUESTED, {});
      const payload = JSON.parse(sqsRecord.body).detail;
      const ctx = { tenantId: 'SYSTEM', eventId: payload.id };

      await handlers[MarketwatchAdptEventTypes.FETCH_REQUESTED](payload, ctx);

      expect(mockGetBaseUrl).toHaveBeenCalledTimes(1);
      for (const feedPath of FEED_PATHS) {
        expect(mockFetchFeed).toHaveBeenCalledWith(`${TEST_BASE_URL}/${feedPath}`);
      }
    });

    it('returns a WriteIntent for each successful feed fetch', async () => {
      const sqsRecord = fakeSqsRecord(MarketwatchAdptEventTypes.FETCH_REQUESTED, {});
      const payload = JSON.parse(sqsRecord.body).detail;
      const ctx = { tenantId: 'SYSTEM', eventId: payload.id };

      const intents = await handlers[MarketwatchAdptEventTypes.FETCH_REQUESTED](payload, ctx);

      expect(intents).toHaveLength(FEED_PATHS.length);
    });

    it('skips feeds where fetchFeed returns null', async () => {
      mockFetchFeed
        .mockResolvedValueOnce(null)
        .mockResolvedValue(SAMPLE_XML);

      const sqsRecord = fakeSqsRecord(MarketwatchAdptEventTypes.FETCH_REQUESTED, {});
      const payload = JSON.parse(sqsRecord.body).detail;
      const ctx = { tenantId: 'SYSTEM', eventId: payload.id };

      const intents = await handlers[MarketwatchAdptEventTypes.FETCH_REQUESTED](payload, ctx);

      expect(intents).toHaveLength(FEED_PATHS.length - 1);
    });

    it('returns empty array when all feeds return null', async () => {
      mockFetchFeed.mockResolvedValue(null);

      const sqsRecord = fakeSqsRecord(MarketwatchAdptEventTypes.FETCH_REQUESTED, {});
      const payload = JSON.parse(sqsRecord.body).detail;
      const ctx = { tenantId: 'SYSTEM', eventId: payload.id };

      const intents = await handlers[MarketwatchAdptEventTypes.FETCH_REQUESTED](payload, ctx);

      expect(intents).toHaveLength(0);
    });

    it('WriteIntents have entity type MarketWatchArticle with correct pk/sk', async () => {
      mockFetchFeed.mockResolvedValueOnce(SAMPLE_XML).mockResolvedValue(null);

      const sqsRecord = fakeSqsRecord(MarketwatchAdptEventTypes.FETCH_REQUESTED, {});
      const payload = JSON.parse(sqsRecord.body).detail;
      const ctx = { tenantId: 'SYSTEM', eventId: payload.id };

      const intents = await handlers[MarketwatchAdptEventTypes.FETCH_REQUESTED](payload, ctx);

      expect(intents).toHaveLength(1);
      const intent = intents[0] as Record<string, unknown>;
      expect(intent.typename).toBe('MarketWatchArticle');
      expect(intent.overrides.pk).toBe('MarketWatch#SYSTEM');
      expect(intent.overrides.sk).toBe(`Feed#${FEED_PATHS[0]}`);
    });

    it('calls parseRss with the fetched XML for each successful feed', async () => {
      const sqsRecord = fakeSqsRecord(MarketwatchAdptEventTypes.FETCH_REQUESTED, {});
      const payload = JSON.parse(sqsRecord.body).detail;
      const ctx = { tenantId: 'SYSTEM', eventId: payload.id };

      await handlers[MarketwatchAdptEventTypes.FETCH_REQUESTED](payload, ctx);

      expect(mockParseRss).toHaveBeenCalledTimes(FEED_PATHS.length);
      expect(mockParseRss).toHaveBeenCalledWith(SAMPLE_XML);
    });
  });

  describe('createDeps', () => {
    it('returns an object with getBaseUrl, fetchFeed, and parseRss functions', () => {
      const deps = createDeps();
      expect(typeof deps.getBaseUrl).toBe('function');
      expect(typeof deps.fetchFeed).toBe('function');
      expect(typeof deps.parseRss).toBe('function');
    });
  });

  describe('FEED_PATHS', () => {
    it('contains 2 feed paths', () => {
      expect(FEED_PATHS).toHaveLength(2);
    });

    it('includes topstories and marketpulse', () => {
      expect(FEED_PATHS).toContain('topstories');
      expect(FEED_PATHS).toContain('marketpulse');
    });
  });
});
