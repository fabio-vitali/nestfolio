import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } };
}

/**
 * Mock agent runtime that returns canned responses.
 * Simulates the LangGraph agent decision lifecycle without real Bedrock calls.
 */
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const body = JSON.parse(event.body ?? '{}');

  // Return a canned agent result based on the input event type
  return json(200, {
    status: 'COMPLETED',
    output: {
      recommendation: 'REBALANCE',
      proposedTrades: [
        { symbol: 'VTI', side: 'BUY', quantity: 5, targetWeightPercent: 60 },
        { symbol: 'BND', side: 'BUY', quantity: 10, targetWeightPercent: 40 },
      ],
      explanation: 'Mock agent recommendation for integration test',
      confidenceScore: 0.85,
      riskAssessment: 'LOW',
    },
  });
}
