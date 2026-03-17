const mockPublishOrUpload = jest.fn().mockResolvedValue(undefined);

jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
  EventBridgeBus: jest.fn().mockImplementation(() => ({ publish: jest.fn() })),
  publishOrUpload: mockPublishOrUpload,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  envVar: jest.fn().mockImplementation((name: string) => {
    const vars: Record<string, string> = {
      BUS_NAME: 'test-bus',
      SERVICE_NAME: 'yahoo-finance-adpt',
      KB_BUCKET: 'test-kb-bucket',
      TICKERS: 'VTI,BND,QQQ',
    };
    return vars[name] ?? '';
  }),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

import { createHandler } from '../src/handlers/event-publisher';

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>VTI hits record high</title>
      <link>https://finance.yahoo.com/news/vti-record</link>
      <pubDate>Mon, 17 Mar 2026 10:00:00 GMT</pubDate>
      <description>Total market ETF reaches new all-time high</description>
    </item>
  </channel>
</rss>`;

describe('yahoo-finance-adpt event-publisher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(SAMPLE_RSS),
    });
  });

  it('fetches RSS for each ticker and publishes events', async () => {
    const handler = createHandler();
    await handler();

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://feeds.finance.yahoo.com/rss/2.0/headline?s=VTI',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    expect(mockPublishOrUpload).toHaveBeenCalledTimes(3);
    const firstCall = mockPublishOrUpload.mock.calls[0][0];
    expect(firstCall.eventType).toBe('YAHOO_FINANCE_UPDATED');
    expect(firstCall.content.source).toBe('yahoo-finance');
    expect(firstCall.content.ticker).toBe('VTI');
    expect(firstCall.content.articles).toHaveLength(1);
    expect(firstCall.content.articles[0].title).toBe('VTI hits record high');
  });

  it('continues processing remaining tickers when one fetch fails', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValue({ ok: true, text: () => Promise.resolve(SAMPLE_RSS) });

    const handler = createHandler();
    await handler();

    expect(mockPublishOrUpload).toHaveBeenCalledTimes(2);
  });

  it('skips ticker when RSS response is not ok', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, text: () => Promise.resolve('') });
    mockFetch.mockResolvedValue({ ok: true, text: () => Promise.resolve(SAMPLE_RSS) });

    const handler = createHandler();
    await handler();

    expect(mockPublishOrUpload).toHaveBeenCalledTimes(2);
  });
});
