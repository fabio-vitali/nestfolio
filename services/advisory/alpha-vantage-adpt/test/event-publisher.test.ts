const mockPublishOrUpload = jest.fn().mockResolvedValue(undefined);

jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
  EventBridgeBus: jest.fn().mockImplementation(() => ({ publish: jest.fn() })),
  publishOrUpload: mockPublishOrUpload,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  envVar: jest.fn().mockImplementation((name: string) => {
    const vars: Record<string, string> = {
      BUS_NAME: 'test-bus',
      SERVICE_NAME: 'alpha-vantage-adpt',
      KB_BUCKET: 'test-kb-bucket',
      ALPHA_VANTAGE_API_KEY: 'test-av-key',
    };
    return vars[name] ?? '';
  }),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

import { createHandler } from '../src/handlers/event-publisher';

const SAMPLE_NEWS_RESPONSE = {
  feed: [
    {
      title: 'VTI gains 2%',
      url: 'https://example.com/vti-gains',
      time_published: '20260317T100000',
      summary: 'Total market ETF surges',
      overall_sentiment_score: 0.85,
      overall_sentiment_label: 'Bullish',
      ticker_sentiment: [{ ticker: 'VTI', relevance_score: '0.95', ticker_sentiment_score: '0.88' }],
    },
  ],
};

const SAMPLE_ECONOMIC_RESPONSE = {
  name: 'Real GDP',
  data: [{ date: '2026-01-01', value: '22000.5' }],
};

describe('alpha-vantage-adpt event-publisher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(SAMPLE_NEWS_RESPONSE),
    });
  });

  it('fetches news sentiment for configured tickers', async () => {
    const handler = createHandler();
    await handler();

    const newsCalls = mockFetch.mock.calls.filter(
      (c: any) => (c[0] as string).includes('NEWS_SENTIMENT'),
    );
    expect(newsCalls.length).toBeGreaterThan(0);

    expect(mockPublishOrUpload).toHaveBeenCalled();
    const newsCall = mockPublishOrUpload.mock.calls.find(
      (c: any) => c[0].content.type === 'news',
    );
    expect(newsCall).toBeDefined();
    expect(newsCall![0].eventType).toBe('ALPHA_VANTAGE_NEWS_UPDATED');
    expect(newsCall![0].content.source).toBe('alpha-vantage');
  });

  it('fetches economic indicators', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(SAMPLE_ECONOMIC_RESPONSE),
    });

    const handler = createHandler();
    await handler();

    const econCalls = mockFetch.mock.calls.filter(
      (c: any) => {
        const url = c[0] as string;
        return url.includes('REAL_GDP') || url.includes('CPI') || url.includes('TREASURY_YIELD');
      },
    );
    expect(econCalls.length).toBeGreaterThan(0);
  });

  it('respects 25 request budget', async () => {
    const handler = createHandler();
    await handler();

    expect(mockFetch.mock.calls.length).toBeLessThanOrEqual(25);
  });

  it('continues when a request fails', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('Rate limited'))
      .mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(SAMPLE_NEWS_RESPONSE),
      });

    const handler = createHandler();
    await handler();

    expect(mockPublishOrUpload).toHaveBeenCalled();
  });
});
