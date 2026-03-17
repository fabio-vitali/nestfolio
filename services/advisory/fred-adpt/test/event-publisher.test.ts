const mockPublishOrUpload = jest.fn().mockResolvedValue(undefined);

jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
  EventBridgeBus: jest.fn().mockImplementation(() => ({ publish: jest.fn() })),
  publishOrUpload: mockPublishOrUpload,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  envVar: jest.fn().mockImplementation((name: string) => {
    const vars: Record<string, string> = {
      BUS_NAME: 'test-bus',
      SERVICE_NAME: 'fred-adpt',
      KB_BUCKET: 'test-kb-bucket',
      FRED_API_KEY: 'test-api-key',
    };
    return vars[name] ?? '';
  }),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

import { createHandler, TRACKED_SERIES } from '../src/handlers/event-publisher';

const SAMPLE_FRED_RESPONSE = {
  observations: [
    { date: '2026-03-17', value: '5.33' },
    { date: '2026-03-16', value: '5.31' },
  ],
};

describe('fred-adpt event-publisher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(SAMPLE_FRED_RESPONSE),
    });
  });

  it('fetches all tracked series and publishes a single aggregated event', async () => {
    const handler = createHandler();
    await handler();

    expect(mockFetch).toHaveBeenCalledTimes(TRACKED_SERIES.length);

    expect(mockPublishOrUpload).toHaveBeenCalledTimes(1);
    const call = mockPublishOrUpload.mock.calls[0][0];
    expect(call.eventType).toBe('FRED_INDICATORS_UPDATED');
    expect(call.content.source).toBe('fred');
    expect(call.content.indicators).toBeInstanceOf(Array);
    expect(call.content.indicators.length).toBeGreaterThan(0);
    expect(call.content.indicators[0]).toEqual(
      expect.objectContaining({ seriesId: expect.any(String), date: expect.any(String), value: expect.any(String) }),
    );
  });

  it('includes API key in FRED API requests', async () => {
    const handler = createHandler();
    await handler();

    const firstUrl = mockFetch.mock.calls[0][0] as string;
    expect(firstUrl).toContain('api_key=test-api-key');
  });

  it('continues when a series fetch fails', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('Timeout'))
      .mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(SAMPLE_FRED_RESPONSE),
      });

    const handler = createHandler();
    await handler();

    expect(mockPublishOrUpload).toHaveBeenCalledTimes(1);
  });

  it('skips publish when all series fail', async () => {
    mockFetch.mockRejectedValue(new Error('All failing'));

    const handler = createHandler();
    await handler();

    expect(mockPublishOrUpload).not.toHaveBeenCalled();
  });
});
