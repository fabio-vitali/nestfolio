import { materializeToTable, record, requireEnv, logger, type WriteIntent, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { FredAdptEventTypes, type FredIndicator } from '../domain/events';

const FRED_BASE_URL = 'https://api.stlouisfed.org/fred/series/observations';
const FETCH_TIMEOUT_MS = 10_000;

export const TRACKED_SERIES = [
  { seriesId: 'FEDFUNDS', label: 'Federal Funds Rate' },
  { seriesId: 'CPIAUCSL', label: 'CPI (Inflation)' },
  { seriesId: 'DGS10', label: '10-Year Treasury Yield' },
  { seriesId: 'VIXCLS', label: 'VIX (Volatility)' },
  { seriesId: 'SP500', label: 'S&P 500 Index' },
  { seriesId: 'UNRATE', label: 'Unemployment Rate' },
  { seriesId: 'DGS1', label: '1-Year Treasury' },
  { seriesId: 'DGS2', label: '2-Year Treasury' },
  { seriesId: 'DGS5', label: '5-Year Treasury' },
  { seriesId: 'DGS30', label: '30-Year Treasury' },
  { seriesId: 'BAMLC0A0CM', label: 'Corporate Bond Spread' },
] as const;

function getObservationStartDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}

export interface EventListenerDeps {
  fetchSeries: (seriesId: string, startDate: string) => Promise<FredIndicator | null>;
}

export function createDeps(apiKey: string): EventListenerDeps {
  return {
    fetchSeries: async (seriesId: string, startDate: string) => {
      const series = TRACKED_SERIES.find((s) => s.seriesId === seriesId);
      if (!series) return null;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      try {
        const url = `${FRED_BASE_URL}?series_id=${seriesId}&api_key=${apiKey}&file_type=json&observation_start=${startDate}&sort_order=desc&limit=1`;
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);

        if (!response.ok) {
          logger.warn('FRED fetch failed', { seriesId, status: response.status });
          return null;
        }

        const data = await response.json() as { observations: Array<{ date: string; value: string }> };
        const latest = data.observations?.[0];

        if (latest && latest.value !== '.') {
          return {
            seriesId,
            label: series.label,
            date: latest.date,
            value: latest.value,
          };
        }
        return null;
      } catch (error) {
        clearTimeout(timeout);
        logger.error('Failed to fetch series', { seriesId, error });
        return null;
      }
    },
  };
}

async function handleFetchRequested(
  deps: EventListenerDeps,
  _payload: EventPayload,
  _ctx: EventContext,
): Promise<WriteIntent[]> {
  const startDate = getObservationStartDate();
  logger.info('Starting FRED indicator fetch', { seriesCount: TRACKED_SERIES.length, startDate });

  const intents: WriteIntent[] = [];

  for (const series of TRACKED_SERIES) {
    const indicator = await deps.fetchSeries(series.seriesId, startDate);

    if (indicator) {
      intents.push(
        record('FredIndicator', indicator, {
          pk: 'Fred#SYSTEM',
          sk: `Indicator#${series.seriesId}`,
        }),
      );
    }
  }

  logger.info('FRED fetch complete', { fetched: intents.length, total: TRACKED_SERIES.length });
  return intents;
}

export function createHandlers(deps: EventListenerDeps) {
  return {
    [FredAdptEventTypes.FETCH_REQUESTED]: (payload: EventPayload, ctx: EventContext) =>
      handleFetchRequested(deps, payload, ctx),
  };
}

// Production wiring
const apiKey = requireEnv('FRED_API_KEY');
const deps = createDeps(apiKey);

export const handler = materializeToTable({
  serviceName: 'fred-adpt',
  handlers: createHandlers(deps),
  errorEventType: 'FRED_ADPT_FAILED',
});
