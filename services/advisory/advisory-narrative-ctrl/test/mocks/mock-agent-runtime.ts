import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } };
}

/**
 * Mock agent runtime for advisory-narrative-ctrl.
 * Returns canned explainability agent output.
 */
export async function handler(_event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  return json(200, {
    summary: 'Mock: Your portfolio has been rebalanced to align with your growth objectives.',
    rationale: 'Mock rationale: Market conditions support increased equity exposure.',
    keyFactors: ['Moderate risk tolerance', 'Long-term growth goal', 'Low volatility environment'],
    tone: 'confident',
    wordCount: 18,
    confidence: 0.88,
  });
}
