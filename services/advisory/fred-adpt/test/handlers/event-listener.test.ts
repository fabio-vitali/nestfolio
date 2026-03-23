import { fakeSqsRecord } from '@nestfolio/event-processor';

jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
  requireEnv: jest.fn().mockImplementation((name: string) => {
    const vars: Record<string, string> = {
      FRED_API_KEY: 'test-fred-key',
      TABLE_NAME: 'test-table',
      BUS_NAME: 'test-bus',
      SERVICE_NAME: 'fred-adpt',
    };
    return vars[name] ?? '';
  }),
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

import { createDeps, createHandlers, TRACKED_SERIES } from '../../src/handlers/event-listener';
import { FredAdptEventTypes } from '../../src/domain/events';

const SAMPLE_INDICATOR = {
  seriesId: 'FEDFUNDS',
  label: 'Federal Funds Rate',
  date: '2026-03-17',
  value: '5.33',
};

describe('fred-adpt event-listener', () => {
  let mockFetchSeries: jest.Mock;
  let handlers: ReturnType<typeof createHandlers>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchSeries = jest.fn().mockResolvedValue(SAMPLE_INDICATOR);
    const deps = { fetchSeries: mockFetchSeries };
    handlers = createHandlers(deps);
  });

  describe('FETCH_FRED_REQUESTED handler', () => {
    it('calls fetchSeries for each tracked series', async () => {
      const sqsRecord = fakeSqsRecord(FredAdptEventTypes.FETCH_REQUESTED, {});
      const payload = JSON.parse(sqsRecord.body).detail;
      const ctx = { tenantId: 'SYSTEM', eventId: payload.id };

      await handlers[FredAdptEventTypes.FETCH_REQUESTED](payload, ctx);

      expect(mockFetchSeries).toHaveBeenCalledTimes(TRACKED_SERIES.length);
    });

    it('calls fetchSeries with each seriesId and a startDate string', async () => {
      const sqsRecord = fakeSqsRecord(FredAdptEventTypes.FETCH_REQUESTED, {});
      const payload = JSON.parse(sqsRecord.body).detail;
      const ctx = { tenantId: 'SYSTEM', eventId: payload.id };

      await handlers[FredAdptEventTypes.FETCH_REQUESTED](payload, ctx);

      for (const series of TRACKED_SERIES) {
        expect(mockFetchSeries).toHaveBeenCalledWith(
          series.seriesId,
          expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        );
      }
    });

    it('returns a WriteIntent for each successful fetch', async () => {
      const sqsRecord = fakeSqsRecord(FredAdptEventTypes.FETCH_REQUESTED, {});
      const payload = JSON.parse(sqsRecord.body).detail;
      const ctx = { tenantId: 'SYSTEM', eventId: payload.id };

      const intents = await handlers[FredAdptEventTypes.FETCH_REQUESTED](payload, ctx);

      expect(intents).toHaveLength(TRACKED_SERIES.length);
    });

    it('skips series where fetchSeries returns null', async () => {
      mockFetchSeries
        .mockResolvedValueOnce(null)
        .mockResolvedValue(SAMPLE_INDICATOR);

      const sqsRecord = fakeSqsRecord(FredAdptEventTypes.FETCH_REQUESTED, {});
      const payload = JSON.parse(sqsRecord.body).detail;
      const ctx = { tenantId: 'SYSTEM', eventId: payload.id };

      const intents = await handlers[FredAdptEventTypes.FETCH_REQUESTED](payload, ctx);

      expect(intents).toHaveLength(TRACKED_SERIES.length - 1);
    });

    it('returns empty array when all fetches return null', async () => {
      mockFetchSeries.mockResolvedValue(null);

      const sqsRecord = fakeSqsRecord(FredAdptEventTypes.FETCH_REQUESTED, {});
      const payload = JSON.parse(sqsRecord.body).detail;
      const ctx = { tenantId: 'SYSTEM', eventId: payload.id };

      const intents = await handlers[FredAdptEventTypes.FETCH_REQUESTED](payload, ctx);

      expect(intents).toHaveLength(0);
    });

    it('WriteIntents have entity type FredIndicator with correct pk/sk', async () => {
      mockFetchSeries.mockResolvedValueOnce(SAMPLE_INDICATOR).mockResolvedValue(null);

      const sqsRecord = fakeSqsRecord(FredAdptEventTypes.FETCH_REQUESTED, {});
      const payload = JSON.parse(sqsRecord.body).detail;
      const ctx = { tenantId: 'SYSTEM', eventId: payload.id };

      const intents = await handlers[FredAdptEventTypes.FETCH_REQUESTED](payload, ctx);

      expect(intents).toHaveLength(1);
      const intent = intents[0] as any;
      expect(intent.typename).toBe('FredIndicator');
      expect(intent.overrides.pk).toBe('Fred#SYSTEM');
      expect(intent.overrides.sk).toBe('Indicator#FEDFUNDS');
    });
  });

  describe('createDeps', () => {
    it('returns an object with fetchSeries function', () => {
      const deps = createDeps('test-key');
      expect(typeof deps.fetchSeries).toBe('function');
    });
  });

  describe('TRACKED_SERIES', () => {
    it('contains 11 series', () => {
      expect(TRACKED_SERIES).toHaveLength(11);
    });

    it('includes FEDFUNDS and CPIAUCSL', () => {
      const ids = TRACKED_SERIES.map((s) => s.seriesId);
      expect(ids).toContain('FEDFUNDS');
      expect(ids).toContain('CPIAUCSL');
    });
  });
});
