import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } };
}

const MOCK_VALUES: Record<string, string> = {
  FEDFUNDS: '5.33',
  CPIAUCSL: '314.069',
  DGS10: '4.25',
  VIXCLS: '14.5',
  SP500: '5200.00',
  UNRATE: '3.7',
  DGS1: '5.10',
  DGS2: '4.90',
  DGS5: '4.30',
  DGS30: '4.45',
  BAMLC0A0CM: '1.28',
};

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const params = event.queryStringParameters ?? {};
  const seriesId = params['series_id'] ?? '';

  if (!seriesId) {
    return json(400, { error_message: 'Missing series_id parameter' });
  }

  const value = MOCK_VALUES[seriesId];
  if (!value) {
    return json(200, { observations: [] });
  }

  return json(200, {
    realtime_start: '2026-04-01',
    realtime_end: '2026-04-07',
    observation_start: '2026-03-31',
    observation_end: '2026-04-07',
    units: 'lin',
    output_type: 1,
    file_type: 'json',
    order_by: 'observation_date',
    sort_order: 'desc',
    count: 1,
    offset: 0,
    limit: 1,
    observations: [
      { realtime_start: '2026-04-07', realtime_end: '2026-04-07', date: '2026-04-04', value },
    ],
  });
}
