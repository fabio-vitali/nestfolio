import {
  EventBridgeBus,
  envVar,
  logger,
  publishOrUpload,
} from '@nestfolio/event-processor';
import { FredAdptEventTypes } from '../domain/events';

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

export function createHandler() {
  const busName = envVar('BUS_NAME');
  const serviceName = envVar('SERVICE_NAME');
  const bucket = envVar('KB_BUCKET');
  const apiKey = envVar('FRED_API_KEY');

  const bus = new EventBridgeBus(busName, serviceName);

  return async (): Promise<void> => {
    const startDate = getObservationStartDate();
    logger.info('Starting FRED indicator fetch', { seriesCount: TRACKED_SERIES.length, startDate });

    const indicators: Array<{ seriesId: string; label: string; date: string; value: string }> = [];

    for (const series of TRACKED_SERIES) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        const url = `${FRED_BASE_URL}?series_id=${series.seriesId}&api_key=${apiKey}&file_type=json&observation_start=${startDate}&sort_order=desc&limit=1`;
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);

        if (!response.ok) {
          logger.warn('FRED fetch failed', { seriesId: series.seriesId, status: response.status });
          continue;
        }

        const data = await response.json() as { observations: Array<{ date: string; value: string }> };
        const latest = data.observations?.[0];

        if (latest && latest.value !== '.') {
          indicators.push({
            seriesId: series.seriesId,
            label: series.label,
            date: latest.date,
            value: latest.value,
          });
        }
      } catch (error) {
        logger.error('Failed to fetch series', { seriesId: series.seriesId, error });
      }
    }

    if (indicators.length === 0) {
      logger.warn('No indicators fetched, skipping publish');
      return;
    }

    await publishOrUpload({
      bus,
      bucket,
      eventType: FredAdptEventTypes.FRED_INDICATORS_UPDATED,
      content: { source: 'fred', indicators },
      serviceName,
    });

    logger.info('Published FRED indicators', { count: indicators.length });
  };
}

export const handler = createHandler();
