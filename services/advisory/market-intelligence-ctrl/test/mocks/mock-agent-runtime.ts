import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } };
}

/**
 * Mock agent runtime for market-intelligence-ctrl.
 * Returns canned market research agent output.
 */
export async function handler(_event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  return json(200, {
    signals: [
      { indicator: 'VIX', value: 18.5, interpretation: 'LOW_VOLATILITY' },
      { indicator: 'SPY_RSI', value: 55, interpretation: 'NEUTRAL' },
    ],
    tickersMentioned: ['SPY', 'VTI', 'BND'],
    marketOutlook: 'NEUTRAL_BULLISH',
    confidenceScore: 0.82,
    metadata: { analysisTimestamp: new Date().toISOString(), modelVersion: 'mock-v1' },
  });
}
