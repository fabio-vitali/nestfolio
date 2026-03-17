const mockPublishOrUpload = jest.fn().mockResolvedValue(undefined);

jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
  EventBridgeBus: jest.fn().mockImplementation(() => ({ publish: jest.fn() })),
  publishOrUpload: mockPublishOrUpload,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  envVar: jest.fn().mockImplementation((name: string) => {
    const vars: Record<string, string> = {
      BUS_NAME: 'test-bus',
      SERVICE_NAME: 'marketwatch-adpt',
      KB_BUCKET: 'test-kb-bucket',
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
      <title>Markets surge</title>
      <link>https://www.marketwatch.com/story/markets-surge</link>
      <pubDate>Mon, 17 Mar 2026 14:00:00 GMT</pubDate>
      <description>Major indices close at record highs</description>
    </item>
  </channel>
</rss>`;

describe('marketwatch-adpt event-publisher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(SAMPLE_RSS),
    });
  });

  it('fetches both RSS feeds and publishes events', async () => {
    const handler = createHandler();
    await handler();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://feeds.marketwatch.com/marketwatch/topstories',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      'https://feeds.marketwatch.com/marketwatch/marketpulse',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    expect(mockPublishOrUpload).toHaveBeenCalledTimes(2);
    const firstCall = mockPublishOrUpload.mock.calls[0][0];
    expect(firstCall.eventType).toBe('MARKETWATCH_UPDATED');
    expect(firstCall.content.source).toBe('marketwatch');
    expect(firstCall.content.feed).toBe('topstories');
  });

  it('continues when one feed fails', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValue({ ok: true, text: () => Promise.resolve(SAMPLE_RSS) });

    const handler = createHandler();
    await handler();

    expect(mockPublishOrUpload).toHaveBeenCalledTimes(1);
  });
});
