import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } };
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const params = event.queryStringParameters ?? {};
  const fn = params['function'] ?? '';

  // News sentiment endpoint
  if (fn === 'NEWS_SENTIMENT') {
    const tickers = params['tickers'] ?? 'VTI';
    return json(200, {
      items: '3',
      sentiment_score_definition: 'mock',
      feed: [
        {
          title: 'Mock Alpha Vantage Article 1',
          url: 'https://mock.example.com/article-1',
          time_published: '20260407T120000',
          summary: 'Integration test mock article for alpha-vantage-adpt',
          source: 'MockNews',
          ticker_sentiment: [{ ticker: tickers.split(',')[0], relevance_score: '0.95', ticker_sentiment_score: '0.5' }],
        },
        {
          title: 'Mock Alpha Vantage Article 2',
          url: 'https://mock.example.com/article-2',
          time_published: '20260407T110000',
          summary: 'Second mock article',
          source: 'MockNews',
          ticker_sentiment: [{ ticker: tickers.split(',')[0], relevance_score: '0.80', ticker_sentiment_score: '-0.2' }],
        },
      ],
    });
  }

  // Economic indicator endpoints (REAL_GDP, CPI, etc.)
  if (['REAL_GDP', 'CPI', 'TREASURY_YIELD', 'FEDERAL_FUNDS_RATE', 'UNEMPLOYMENT'].includes(fn)) {
    return json(200, {
      name: fn,
      interval: 'annual',
      unit: 'percent',
      data: [
        { date: '2026-01-01', value: '2.5' },
        { date: '2025-01-01', value: '2.3' },
      ],
    });
  }

  return json(400, { 'Error Message': `Unknown function: ${fn}` });
}
